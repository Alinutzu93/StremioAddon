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
    logo: 'https://subtitrari-noi.ro/imgs/logo_subtitrari.png'
};

const builder = new addonBuilder(manifest);

// Funcție pentru a găsi ID-ul intern al filmului/serialului
async function findMovieId(imdbId) {
    try {
        // Căutăm după IMDB ID pe site
        const searchUrl = `https://www.subtitrari-noi.ro/?s=${imdbId}`;
        console.log(`🔍 Căutare: ${searchUrl}`);
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        
        // Căutăm link-ul către pagina filmului
        // Format: /index.php?page=movie_details&act=1&id=XXXXX
        let movieId = null;
        
        $('a[href*="movie_details"]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
                const match = href.match(/id=(\d+)/);
                if (match && match[1]) {
                    movieId = match[1];
                    console.log(`✅ Găsit ID film: ${movieId}`);
                    return false; // stop loop
                }
            }
        });
        
        return movieId;
    } catch (error) {
        console.error('❌ Eroare la căutarea ID-ului:', error.message);
        return null;
    }
}

// Funcție pentru a obține subtitrările de pe pagina filmului
async function getSubtitlesFromMoviePage(movieId, type, season, episode) {
    try {
        const movieUrl = `https://www.subtitrari-noi.ro/index.php?page=movie_details&act=1&id=${movieId}`;
        console.log(`📄 Accesez pagina: ${movieUrl}`);
        
        const response = await axios.get(movieUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const subtitles = [];
        
        // Găsim titlul filmului
        const title = $('h3').first().text().trim();
        console.log(`🎬 Film: ${title}`);
        
        // Găsim link-ul de download
        // Format: href="httpS://www.subtitrari-noi.ro/XXXXX-subtitrari-noi.ro-....zip"
        const downloadLink = $('a.button.bt1[href*=".zip"]').attr('href');
        
        if (downloadLink) {
            // Pentru seriale, verificăm sezonul și episodul în comentariu sau titlu
            const comentariu = $('li:contains("Comentariu:")').text();
            
            if (type === 'series' && season && episode) {
                // Verificăm dacă subtitrarea e pentru sezonul/episodul corect
                const seasonPattern = new RegExp(`S0?${season}`, 'i');
                const episodePattern = new RegExp(`E0?${episode}`, 'i');
                
                const textToCheck = comentariu + ' ' + title;
                
                if (seasonPattern.test(textToCheck) && episodePattern.test(textToCheck)) {
                    subtitles.push({
                        id: `subtitrari-noi:${movieId}`,
                        url: downloadLink,
                        lang: 'ron',
                        title: `🇷🇴 ${title}`
                    });
                    console.log(`✅ Subtitrare găsită pentru S${season}E${episode}`);
                } else {
                    console.log(`⚠️ Subtitrare nu corespunde: S${season}E${episode}`);
                }
            } else if (type === 'movie') {
                // Pentru filme, adăugăm direct
                subtitles.push({
                    id: `subtitrari-noi:${movieId}`,
                    url: downloadLink,
                    lang: 'ron',
                    title: `🇷🇴 ${title}`
                });
                console.log(`✅ Subtitrare găsită pentru film`);
            }
        } else {
            console.log('❌ Nu s-a găsit link de download');
        }
        
        return subtitles;
    } catch (error) {
        console.error('❌ Eroare la accesarea paginii:', error.message);
        return [];
    }
}

// Funcție principală pentru căutarea subtitrărilor
async function searchSubtitles(imdbId, type, season, episode) {
    try {
        console.log(`\n🎯 Cerere nouă: ${type} - ${imdbId}${season ? ` S${season}E${episode}` : ''}`);
        
        // Pasul 1: Găsim ID-ul intern
        const movieId = await findMovieId(imdbId);
        
        if (!movieId) {
            console.log('❌ Nu s-a găsit filmul pe site');
            return [];
        }
        
        // Pasul 2: Obținem subtitrările
        const subtitles = await getSubtitlesFromMoviePage(movieId, type, season, episode);
        
        console.log(`📊 Total subtitrări găsite: ${subtitles.length}`);
        return subtitles;
        
    } catch (error) {
        console.error('❌ Eroare generală:', error.message);
        return [];
    }
}

// Handler pentru cereri de subtitrări
builder.defineSubtitlesHandler(async (args) => {
    console.log('\n' + '='.repeat(60));
    console.log('📥 Cerere subtitrări:', JSON.stringify(args, null, 2));
    
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

    console.log('📤 Răspuns:', subtitles.length > 0 ? 'Subtitrări găsite!' : 'Nicio subtitrare');
    console.log('='.repeat(60));

    return { subtitles };
});

// Pornește serverul
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { 
    port: port,
    hostname: '0.0.0.0'
});

console.log('\n' + '🚀'.repeat(30));
console.log('✅ Addon Subtitrari-Noi.ro PORNIT!');
console.log(`📍 Port: ${port}`);
console.log(`🌐 Manifest: http://localhost:${port}/manifest.json`);
console.log(`📝 Pentru Stremio: Adaugă URL-ul manifest.json în Community Addons`);
console.log('🚀'.repeat(30) + '\n');
