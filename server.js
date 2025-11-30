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

// Funcție simplificată pentru căutare directă după IMDB numeric
async function searchDirectByImdb(imdbNumeric, expectedTitle = null) {
    const cacheKey = `search:${imdbNumeric}`;
    
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log('📦 Folosesc rezultate din cache');
            return cached.data;
        }
    }
    
    try {
        // Ștergem zerouri din față (0468569 -> 468569)
        const imdbClean = imdbNumeric.replace(/^0+/, '');
        
        // Încercăm ambele variante
        const searchVariants = [
            imdbClean,    // 468569 (fără zerouri) - PRIORITATE
            imdbNumeric   // 0468569
        ];
        
        for (const variant of searchVariants) {
            console.log(`🔍 Caut via paginare_filme.php: ${variant}`);
            
            // Site-ul folosește paginare_filme.php pentru rezultate!
            const ajaxUrl = `https://www.subtitrari-noi.ro/paginare_filme.php`;
            
            const response = await axios.post(ajaxUrl, new URLSearchParams({
                'search_q': '1',
                'cautare': variant,
                'tip': '2',  // 2 = toate filmele
                'page_nr': '1'
            }), {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml',
                    'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://www.subtitrari-noi.ro/'
                },
                timeout: 15000
            });

            const $ = cheerio.load(response.data);
            
            // Colectăm TOATE rezultatele
            const results = [];
            
            // Căutăm link-uri de forma: /Subtitrari-YYYY/Nume_Film_(YYYY)/ID
            $('a[href*="/Subtitrari-"], a[href*="movie_details"]').each((i, elem) => {
                const href = $(elem).attr('href');
                const text = $(elem).text().trim();
                
                if (href && text) {
                    let movieId = null;
                    
                    // Format 1: /Subtitrari-2008/The_Dark_Knight_(2008)/12345
                    let match = href.match(/\/(\d+)$/);
                    if (match && match[1]) {
                        movieId = match[1];
                    }
                    
                    // Format 2: index.php?page=movie_details&act=1&id=12345
                    if (!movieId) {
                        match = href.match(/id=(\d+)/);
                        if (match && match[1]) {
                            movieId = match[1];
                        }
                    }
                    
                    if (movieId && text.length > 3) {  // Ignoră link-uri fără text
                        results.push({
                            id: movieId,
                            href: href,
                            text: text
                        });
                    }
                }
            });
            
            // Eliminăm duplicate (același ID)
            const uniqueResults = [];
            const seenIds = new Set();
            for (const result of results) {
                if (!seenIds.has(result.id)) {
                    seenIds.add(result.id);
                    uniqueResults.push(result);
                }
            }
            
            if (uniqueResults.length > 0) {
                console.log(`✅ Găsite ${uniqueResults.length} rezultate pentru "${variant}"`);
                uniqueResults.forEach((r, i) => {
                    console.log(`   ${i + 1}. ID=${r.id} - "${r.text}"`);
                });
                
                // Dacă avem un titlu așteptat, încercăm să găsim match-ul corect
                if (expectedTitle && uniqueResults.length > 1) {
                    const normalized = normalize(expectedTitle);
                    console.log(`🔍 Caut match pentru: "${expectedTitle}"`);
                    
                    for (const result of uniqueResults) {
                        const resultNormalized = normalize(result.text);
                        
                        if (resultNormalized.includes(normalized) || normalized.includes(resultNormalized)) {
                            console.log(`   ✅ Match găsit: "${result.text}"`);
                            const finalResult = { id: result.id, href: result.href, text: result.text };
                            cache.set(cacheKey, { data: finalResult, timestamp: Date.now() });
                            return finalResult;
                        }
                    }
                }
                
                // Luăm primul rezultat
                console.log(`📌 Folosesc primul rezultat: ID=${uniqueResults[0].id} - "${uniqueResults[0].text}"`);
                const result = { id: uniqueResults[0].id, href: uniqueResults[0].href, text: uniqueResults[0].text };
                cache.set(cacheKey, { data: result, timestamp: Date.now() });
                return result;
            }
            
            console.log(`   ⚠️ Niciun rezultat pentru "${variant}"`);
        }
        
        console.log('❌ Nu s-au găsit rezultate pentru nicio variantă');
        return null;
        
    } catch (error) {
        console.error('❌ Eroare la căutare:', error.message);
        return null;
    }
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
        // Extragem doar numerele din IMDB ID (tt1375666 -> 1375666)
        const imdbNumeric = imdbId.replace(/\D/g, '');
        
        // Încercăm mai multe strategii de căutare
        const searchTerms = [
            imdbNumeric,                      // 1375666 (PRIORITATE!)
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
        
        // Obținem info de la OMDB (opțional, doar pentru titlu)
        let titleInfo = null;
        try {
            titleInfo = await getMediaInfo(imdbId, type);
        } catch (e) {
            console.log('⚠️ Nu s-a putut obține info de la OMDB, continuăm fără titlu');
        }
        
        // Extragem numerele din IMDB ID
        const imdbNumeric = imdbId.replace(/\D/g, '');
        console.log(`🔢 IMDB numeric: ${imdbNumeric}`);
        
        // Căutăm cu titlul dacă îl avem
        const searchResult = await searchDirectByImdb(
            imdbNumeric, 
            titleInfo ? titleInfo.title : null
        );
        
        if (!searchResult) {
            console.log('❌ Nu s-a găsit pe site');
            return [];
        }
        
        // Extragem subtitrările
        const subtitles = await getSubtitlesFromPage(
            searchResult.id, 
            type, 
            season, 
            episode,
            titleInfo ? titleInfo.title : 'Subtitrare'
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
