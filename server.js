// server.js
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

// Definirea manifestului addon-ului
const manifest = {
    id: 'ro.subtitrari-noi.stremio',
    version: '1.0.0',
    name: 'Subtitrari-Noi.ro',
    description: 'Subtitrări în limba română de pe subtitrari-noi.ro',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    logo: 'https://subtitrari-noi.ro/themes/extra/img/logo.png'
};

const builder = new addonBuilder(manifest);

// Funcție pentru normalizarea titlului
function normalizeTitle(title) {
    return title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
}

// Funcție pentru căutarea subtitrărilor
async function searchSubtitles(imdbId, type, season, episode) {
    try {
        // Construiește URL-ul de căutare - ADAPTEAZĂ LA STRUCTURA SITE-ULUI TĂU
        const searchUrl = `https://subtitrari-noi.ro/?s=${imdbId}`;
        
        console.log(`Căutare pentru: ${searchUrl}`);
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const subtitles = [];

        // IMPORTANT: Adaptează acești selectori la structura reală a site-ului tău!
        // Exemplu generic - trebuie verificat pe site
        $('.post, article, .subtitle-entry').each((i, elem) => {
            const $elem = $(elem);
            
            // Găsește titlul - adaptează selectorul
            const title = $elem.find('h2, h3, .title, .entry-title').first().text().trim();
            
            // Găsește link-ul de download - adaptează selectorul
            let downloadUrl = $elem.find('a[href*="download"], a[href*=".zip"], a[href*="subtitrare"]').attr('href');
            
            if (!downloadUrl) {
                // Încercă să găsească link-ul în alt mod
                const postLink = $elem.find('a').first().attr('href');
                if (postLink) {
                    downloadUrl = postLink;
                }
            }
            
            if (title && downloadUrl) {
                // Pentru seriale, verifică dacă e episodul corect
                if (type === 'series' && season && episode) {
                    const seasonMatch = title.match(/S(\d+)/i);
                    const episodeMatch = title.match(/E(\d+)/i);
                    
                    if (seasonMatch && episodeMatch) {
                        const s = parseInt(seasonMatch[1]);
                        const e = parseInt(episodeMatch[1]);
                        
                        if (s === parseInt(season) && e === parseInt(episode)) {
                            subtitles.push({
                                id: `subtitrari-noi:${imdbId}:${i}`,
                                url: downloadUrl.startsWith('http') ? downloadUrl : `https://subtitrari-noi.ro${downloadUrl}`,
                                lang: 'ron',
                                title: `🇷🇴 ${title}`
                            });
                        }
                    }
                } else if (type === 'movie') {
                    // Pentru filme, adaugă direct
                    subtitles.push({
                        id: `subtitrari-noi:${imdbId}:${i}`,
                        url: downloadUrl.startsWith('http') ? downloadUrl : `https://subtitrari-noi.ro${downloadUrl}`,
                        lang: 'ron',
                        title: `🇷🇴 ${title}`
                    });
                }
            }
        });

        console.log(`Găsite ${subtitles.length} subtitrări`);
        return subtitles;
        
    } catch (error) {
        console.error('Eroare la căutarea subtitrărilor:', error.message);
        return [];
    }
}

// Handler pentru cereri de subtitrări
builder.defineSubtitlesHandler(async (args) => {
    console.log('Cerere subtitrări pentru:', args);
    
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

    const subtitles = await searchSubtitles(imdbId, type, season, episode);

    return {
        subtitles: subtitles
    };
});

// Pornește serverul
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { 
    port: port,
    hostname: '0.0.0.0'
});

console.log(`✅ Addon Subtitrari-Noi.ro pornit!`);
console.log(`📍 Local: http://localhost:${port}/manifest.json`);
console.log(`🌐 Instalare Stremio: Adaugă URL-ul manifest.json în Community Addons`);