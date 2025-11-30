// server.js
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

// Definirea manifestului addon-ului
const manifest = {
    id: 'ro.subtitrari-noi.stremio',
    version: '1.0.1',
    name: 'Subtitrari-Noi.ro',
    description: 'Subtitrări în limba română de pe subtitrari-noi.ro',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    logo: 'https://subtitrari-noi.ro/imgs/logo_subtitrari.png'
};

const builder = new addonBuilder(manifest);

// Cache pentru a evita apeluri repetate
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30; // 30 minute

// Funcție pentru a obține informații despre film/serial de la TMDB
async function getMediaInfo(imdbId, type) {
    const cacheKey = `info:${imdbId}`;
    
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log('📦 Folosesc info din cache');
            return cached.data;
        }
    }
    
    try {
        // Folosim API-ul public OMDB (nu necesită cheie pentru info de bază)
        // Alternativ: putem folosi direct numele din Stremio Catalog
        const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=3e4cb0d`;
        console.log(`🔍 Obțin info de la OMDB: ${imdbId}`);
        
        const response = await axios.get(url, { timeout: 10000 });
        
        if (response.data && response.data.Title) {
            const info = {
                title: response.data.Title,
                year: response.data.Year,
                type: response.data.Type
            };
            
            cache.set(cacheKey, { data: info, timestamp: Date.now() });
            console.log(`📝 Titlu: ${info.title} (${info.year})`);
            return info;
        }
    } catch (error) {
        console.log('⚠️ OMDB nu răspunde, folosesc fallback');
    }
    
    return null;
}

// Funcție pentru normalizarea textului (pentru comparare)
function normalize(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritice
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Funcție pentru a căuta pe site după numele filmului
async function searchOnSite(title, year, imdbId) {
    const cacheKey = `search:${imdbId}`;
    
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log('📦 Folosesc rezultate din cache');
            return cached.data;
        }
    }
    
    try {
        // Încercăm mai multe strategii de căutare
        const searchTerms = [
            imdbId,                           // tt1375666
            `${title} ${year}`,               // Inception 2010
            title                             // Inception
        ];
        
        for (const term of searchTerms) {
            console.log(`🔍 Caut: "${term}"`);
            const searchUrl = `https://www.subtitrari-noi.ro/?s=${encodeURIComponent(term)}`;
            
            const response = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml',
                    'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8'
                },
                timeout: 15000
            });

            const $ = cheerio.load(response.data);
            const results = [];
            
            // Căutăm toate link-urile către pagini de filme
            $('a[href*="movie_details"]').each((i, elem) => {
                const href = $(elem).attr('href');
                const text = $(elem).text().trim();
                
                if (href) {
                    const match = href.match(/id=(\d+)/);
                    if (match && match[1]) {
                        results.push({
                            id: match[1],
                            text: text,
                            href: href
                        });
                    }
                }
            });
            
            if (results.length > 0) {
                console.log(`✅ Găsite ${results.length} rezultate pentru "${term}"`);
                const result = results[0]; // Luăm primul rezultat
                cache.set(cacheKey, { data: result, timestamp: Date.now() });
                return result;
            }
        }
        
        console.log('❌ Nu s-au găsit rezultate pentru niciun termen');
        return null;
        
    } catch (error) {
        console.error('❌ Eroare la căutare:', error.message);
        return null;
    }
}

// Funcție pentru a obține subtitrările de pe pagina filmului
async function getSubtitlesFromPage(movieId, type, season, episode, title) {
    try {
        const movieUrl = `https://www.subtitrari-noi.ro/index.php?page=movie_details&act=1&id=${movieId}`;
        console.log(`📄 Accesez: ${movieUrl}`);
        
        const response = await axios.get(movieUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const subtitles = [];
        
        // Găsim titlul de pe pagină
        const pageTitle = $('h3').first().text().trim();
        console.log(`🎬 Pagină: ${pageTitle}`);
        
        // Găsim toate link-urile de download (.zip)
        $('a.button.bt1[href*=".zip"]').each((i, elem) => {
            const downloadLink = $(elem).attr('href');
            
            if (downloadLink) {
                // Pentru seriale, verificăm sezonul și episodul
                if (type === 'series' && season && episode) {
                    const comentariu = $('li:contains("Comentariu:")').text();
                    const seasonPattern = new RegExp(`S0?${season}`, 'i');
                    const episodePattern = new RegExp(`E0?${episode}`, 'i');
                    
                    const textToCheck = comentariu + ' ' + pageTitle;
                    
                    if (seasonPattern.test(textToCheck) && episodePattern.test(textToCheck)) {
                        subtitles.push({
                            id: `subtitrari-noi:${movieId}:${i}`,
                            url: downloadLink,
                            lang: 'ron',
                            title: `🇷🇴 Subtitrari-Noi.ro - S${season}E${episode}`
                        });
                        console.log(`✅ Subtitrare pentru S${season}E${episode}`);
                    }
                } else if (type === 'movie') {
                    // Pentru filme, adăugăm subtitrarea
                    subtitles.push({
                        id: `subtitrari-noi:${movieId}:${i}`,
                        url: downloadLink,
                        lang: 'ron',
                        title: `🇷🇴 Subtitrari-Noi.ro - ${title || pageTitle}`
                    });
                    console.log(`✅ Subtitrare găsită`);
                }
            }
        });
        
        return subtitles;
        
    } catch (error) {
        console.error('❌ Eroare la accesarea paginii:', error.message);
        return [];
    }
}

// Funcție principală
async function searchSubtitles(imdbId, type, season, episode) {
    try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎯 Cerere: ${type} - ${imdbId}${season ? ` S${season}E${episode}` : ''}`);
        
        // Pasul 1: Obținem informații despre film/serial
        const info = await getMediaInfo(imdbId, type);
        
        if (!info) {
            console.log('⚠️ Nu s-au putut obține informații despre titlu');
            return [];
        }
        
        // Pasul 2: Căutăm pe site
        const searchResult = await searchOnSite(info.title, info.year, imdbId);
        
        if (!searchResult) {
            console.log('❌ Nu s-a găsit pe site');
            return [];
        }
        
        // Pasul 3: Extragem subtitrările
        const subtitles = await getSubtitlesFromPage(
            searchResult.id, 
            type, 
            season, 
            episode,
            info.title
        );
        
        console.log(`📊 Total: ${subtitles.length} subtitrări`);
        console.log('='.repeat(60));
        
        return subtitles;
        
    } catch (error) {
        console.error('❌ Eroare generală:', error.message);
        return [];
    }
}

// Handler pentru cereri de subtitrări
builder.defineSubtitlesHandler(async (args) => {
    console.log('\n' + '🔔'.repeat(30));
    console.log('📥 CERERE NOUĂ!');
    console.log('📥 Args:', JSON.stringify(args, null, 2));
    console.log('📥 Timestamp:', new Date().toISOString());
    
    const { type, id } = args;
    
    // Extrage IMDB ID
    const imdbId = id.split(':')[0];
    
    // Pentru seriale, extrage sezonul și episodul
    let season, episode;
    if (type === 'series') {
        const parts = id.split(':');
        season = parts[1];
        episode = parts[2];
    }

    try {
        const subtitles = await searchSubtitles(imdbId, type, season, episode);
        
        console.log(`\n📤 RĂSPUNS: ${subtitles.length} subtitrări`);
        if (subtitles.length > 0) {
            console.log('📤 Subtitrări:', JSON.stringify(subtitles, null, 2));
        }
        console.log('🔔'.repeat(30) + '\n');

        return { subtitles };
    } catch (error) {
        console.error('❌ EROARE:', error);
        return { subtitles: [] };
    }
});

// Pornește serverul
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { 
    port: port,
    hostname: '0.0.0.0'
});

console.log('\n' + '🚀'.repeat(30));
console.log('✅ Addon Subtitrari-Noi.ro v1.0.1 PORNIT!');
console.log(`📍 Port: ${port}`);
console.log(`🌐 Manifest: http://localhost:${port}/manifest.json`);
console.log('🚀'.repeat(30) + '\n');
