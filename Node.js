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
    logo: 'https://subtitrari-noi.ro/logo.png' // Înlocuiește cu logo-ul real
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
        const searchUrl = `https://subtitrari-noi.ro/search/${imdbId}`;
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const subtitles = [];

        // Parsează rezultatele - adaptează selectorii CSS la structura site-ului
        $('.subtitle-item, .result-item, .sub-item').each((i, elem) => {
            const $elem = $(elem);
            const title = $elem.find('.title, h3, .sub-title').text().trim();
            const downloadUrl = $elem.find('a[href*="download"], .download-link').attr('href');
            
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
                                id: `subtitrari-noi:${i}`,
                                url: downloadUrl.startsWith('http') ? downloadUrl : `https://subtitrari-noi.ro${downloadUrl}`,
                                lang: 'ron',
                                title: title
                            });
                        }
                    }
                } else if (type === 'movie') {
                    // Pentru filme, adaugă direct
                    subtitles.push({
                        id: `subtitrari-noi:${i}`,
                        url: downloadUrl.startsWith('http') ? downloadUrl : `https://subtitrari-noi.ro${downloadUrl}`,
                        lang: 'ron',
                        title: title
                    });
                }
            }
        });

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
serveHTTP(builder.getInterface(), { port: port });

console.log(`Addon disponibil la: http://localhost:${port}/manifest.json`);
console.log(`Pentru instalare în Stremio: http://localhost:${port}/manifest.json`);