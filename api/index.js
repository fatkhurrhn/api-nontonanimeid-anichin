const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ANIME_BASE_URL = 'https://s11.nontonanimeid.boats';
const DONGHUA_BASE_URL = 'https://anichin.moe';

// Middleware
app.use(cors());
app.use(express.json());


// ============= ANIMEEEEEE =============


// Fungsi untuk scrape data dari halaman
async function scrapeLatestEpisodes(page = 1) {
    try {
        let url = ANIME_BASE_URL;
        
        // Jika page > 1, tambahkan pagination ke URL
        if (page > 1) {
            url = `${ANIME_BASE_URL}/page/${page}/`;
        }
        
        console.log(`Fetching: ${url}`);
        
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
            }
        });
        
        const $ = cheerio.load(data);
        const animeList = [];
        
        // Selector untuk mengambil data dari posts
        $('#postbaru .misha_posts_wrap article.animeseries, .misha_posts_wrap article.animeseries').each((index, element) => {
            const $element = $(element);
            
            // Ambil judul anime
            const title = $element.find('.title.less.nlat span').text().trim() || 
                         $element.find('.title span').text().trim() ||
                         $element.find('img').attr('alt');
            
            // Ambil URL detail anime
            const detailUrl = $element.find('a').attr('href');
            
            // Ambil slug dari URL
            const slug = detailUrl ? detailUrl.replace(`${ANIME_BASE_URL}/anime/`, '').replace('/', '') : 
                         detailUrl ? detailUrl.split('/').filter(Boolean).pop() : '';
            
            // Ambil thumbnail
            let thumbnail = $element.find('img').attr('src') || 
                           $element.find('img').attr('data-src') || 
                           $element.find('img').attr('lazy-src');
            
            // Perbaiki URL thumbnail
            if (thumbnail) {
                if (thumbnail.startsWith('//')) {
                    thumbnail = 'https:' + thumbnail;
                } else if (thumbnail.startsWith('/')) {
                    thumbnail = ANIME_BASE_URL + thumbnail;
                } else if (!thumbnail.startsWith('http')) {
                    thumbnail = ANIME_BASE_URL + '/' + thumbnail;
                }
            }
            
            // Ambil episode
            let episode = $element.find('.types.episodes').text().trim() || 
                         $element.find('.episodes').text().trim() ||
                         $element.find('.types').text().trim();
            
            // Bersihkan teks episode (hapus icon)
            episode = episode.replace(/[^\d]/g, '');
            
            // Ambil tanggal/rilis info jika ada
            const dateInfo = $element.find('.date').text().trim() || 
                            $element.find('.time').text().trim() || '';
            
            animeList.push({
                title: title || 'Unknown Title',
                slug: slug,
                episode: episode || 'Latest',
                thumbnail: thumbnail || null,
                detail_url: detailUrl || null,
                date_info: dateInfo,
                source: 'NontonAnimeID'
            });
        });
        
        // Cek apakah ada next page (untuk mengetahui apakah masih bisa load more)
        const nextPage = $('a.next.page-numbers, .next.page-numbers, .pagination .next, .misha_loadmore.loadmore_button').length > 0 || 
                        $('.load_more').length > 0;
        
        // Total data yang ditemukan
        const totalFound = animeList.length;
        
        return {
            data: animeList,
            pagination: {
                current_page: page,
                has_next_page: nextPage || totalFound >= 20, // Asumsi jika ada 20 data, mungkin masih ada next page
                next_page: nextPage ? page + 1 : null,
                total_in_page: totalFound
            }
        };
        
    } catch (error) {
        console.error(`Error scraping page ${page}:`, error.message);
        throw error;
    }
}

// Fungsi untuk mendapatkan total pages (jika diperlukan)
async function getTotalPages() {
    try {
        const { data } = await axios.get(ANIME_BASE_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(data);
        
        // Coba cari link pagination terakhir
        let lastPage = 1;
        $('.page-numbers').each((i, el) => {
            const pageText = $(el).text().trim();
            if (!isNaN(pageText) && parseInt(pageText) > lastPage) {
                lastPage = parseInt(pageText);
            }
        });
        
        // Jika tidak ditemukan pagination, cek load more button
        const hasLoadMore = $('.misha_loadmore.loadmore_button, .load_more').length > 0;
        
        return {
            last_page: lastPage,
            has_load_more: hasLoadMore,
            estimated_total_pages: hasLoadMore ? 999 : lastPage // Jika ada load more, teorinya bisa infinite
        };
        
    } catch (error) {
        console.error('Error getting total pages:', error.message);
        return {
            last_page: 1,
            has_load_more: true,
            estimated_total_pages: 999
        };
    }
}

// /api/anime/latest?page=1 dst
app.get('/api/anime/latest', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        // Validasi page
        if (page < 1) {
            return res.status(400).json({
                success: false,
                message: 'Page harus lebih besar dari 0'
            });
        }
        
        // Scrape data dari halaman yang diminta
        const result = await scrapeLatestEpisodes(page);
        
        // Ambil info total pages (opsional)
        const pagesInfo = await getTotalPages();
        
        // Response JSON
        res.json({
            success: true,
            data: result.data.slice(0, limit), // Batasi sesuai limit
            pagination: {
                ...result.pagination,
                limit: limit,
                total_data_available: result.data.length,
                has_load_more: pagesInfo.has_load_more,
                total_pages_estimate: pagesInfo.estimated_total_pages
            },
            source: {
                name: 'NontonAnimeID',
                url: ANIME_BASE_URL,
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error scraping data:', error.message);
        
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data dari sumber',
            error: error.message
        });
    }
});

// Endpoint untuk load more (AJAX style)
app.get('/api/anime/latest/load-more', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 2; // Default ke page 2
        const accumulated = parseInt(req.query.accumulated) || 0;
        
        // Scrape data dari halaman yang diminta
        const result = await scrapeLatestEpisodes(page);
        
        // Response khusus untuk load more
        res.json({
            success: true,
            data: result.data,
            pagination: {
                current_page: page,
                next_page: result.pagination.has_next_page ? page + 1 : null,
                has_more: result.pagination.has_next_page,
                accumulated_total: accumulated + result.data.length
            },
            source: {
                name: 'NontonAnimeID',
                url: ANIME_BASE_URL,
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error loading more data:', error.message);
        
        res.status(500).json({
            success: false,
            message: 'Gagal memuat data tambahan',
            error: error.message
        });
    }
});

// Endpoint untuk info pagination
app.get('/api/anime/latest/info', async (req, res) => {
    try {
        const pagesInfo = await getTotalPages();
        
        res.json({
            success: true,
            data: {
                ...pagesInfo,
                ANIME_base_url: ANIME_BASE_URL,
                first_page_url: `${ANIME_BASE_URL}/`,
                next_pages_format: `${ANIME_BASE_URL}/page/{page}/`
            },
            source: {
                name: 'NontonAnimeID',
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil info pagination',
            error: error.message
        });
    }
});

// /api/anime/detail/peter-grill-to-kenja-no-jikan
app.get('/api/anime/detail/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const animeUrl = `${ANIME_BASE_URL}/anime/${slug}/`;
        
        console.log(`Fetching detail: ${animeUrl}`);
        
        // Tambahkan header lebih lengkap agar terlihat seperti browser asli
        const { data } = await axios.get(animeUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.google.com/',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'cross-site',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                'Connection': 'keep-alive'
            }
        });
        
        const $ = cheerio.load(data);
        
        // Ambil judul anime
        const title = $('h1.entry-title.cs').text().trim() || 
                     $('.anime-card__main h1').text().trim() ||
                     $('title').text().replace('Sub Indo Terbaru - Nonton Anime ID', '').trim();
        
        // Ambil thumbnail
        let thumbnail = $('.anime-card__sidebar img').attr('src') || 
                       $('meta[property="og:image"]').attr('content');
        
        // Perbaiki URL thumbnail
        if (thumbnail) {
            if (thumbnail.startsWith('//')) {
                thumbnail = 'https:' + thumbnail;
            } else if (thumbnail.startsWith('/')) {
                thumbnail = ANIME_BASE_URL + thumbnail;
            } else if (!thumbnail.startsWith('http')) {
                thumbnail = ANIME_BASE_URL + '/' + thumbnail;
            }
        }
        
        // Ambil rating
        const rating = $('.anime-card__score .value').text().trim() ||
                      $('.kotakscore').first().text().trim() ||
                      $('span[itemprop="ratingValue"]').text().trim();
        
        // Ambil tipe (TV, Movie, dll)
        const type = $('.anime-card__score .type').text().trim() ||
                    $('.info-item.type').text().trim() ||
                    $('.series-type').text().trim();
        
        // Ambil sinopsis dari tab
        let synopsis = '';
        $('#tab-synopsis .synopsis-prose p').each((i, el) => {
            synopsis += $(el).text().trim() + ' ';
        });
        
        if (!synopsis) {
            synopsis = $('.synopsis-prose p').text().trim() ||
                      $('.entry-content p').first().text().trim() ||
                      $('meta[name="description"]').attr('content') ||
                      '';
        }
        
        // Ambil detail dari tab Details
        const details = {};
        
        $('.details-list li, .anime-info li, .info-list li').each((i, el) => {
            const text = $(el).text().trim();
            if (text.includes(':')) {
                const parts = text.split(':');
                const key = parts[0].replace(/[^a-zA-Z0-9 ]/g, '').trim();
                const value = parts.slice(1).join(':').trim();
                if (key && value) {
                    details[key] = value;
                }
            }
        });
        
        // Ambil judul alternatif (English)
        const englishTitle = details['English'] || 
                            $('.details-list li:contains("English:")').text().replace('English:', '').trim() ||
                            $('strong.detail-label:contains("English")').parent().text().replace('English:', '').trim();
        
        // Ambil studio
        const studio = details['Studios'] || 
                      $('.details-list li:contains("Studios:")').text().replace('Studios:', '').trim() ||
                      $('strong.detail-label:contains("Studios")').parent().text().replace('Studios:', '').trim();
        
        // Ambil genre
        const genres = [];
        $('.anime-card__genres .genre-tag, .in-tab .genre-tag, .genres a, .genre-item').each((i, el) => {
            const genre = $(el).text().trim();
            if (genre && !genres.includes(genre)) {
                genres.push(genre);
            }
        });
        
        // Ambil informasi quick info (status, episode, durasi, season)
        const quickInfo = {
            status: null,
            episodes: null,
            duration: null,
            season: null
        };
        
        $('.anime-card__quick-info .info-item, .quick-info span, .series-info span').each((i, el) => {
            const text = $(el).text().trim();
            if (text.includes('Finished') || text.includes('Airing') || text.includes('Completed')) {
                quickInfo.status = text;
            } else if (text.includes('Episode') || text.includes('ep') || text.match(/\d+\s*Ep/)) {
                quickInfo.episodes = text;
            } else if (text.includes('min') || text.includes('menit')) {
                quickInfo.duration = text;
            } else if (text.match(/Spring|Summer|Fall|Winter/i)) {
                quickInfo.season = text;
            }
        });
        
        // Ambil dari meta tags sebagai cadangan
        if (!quickInfo.episodes) {
            const episodeCount = $('meta[property="og:video:series"]').attr('content') || 
                               $('.total-episodes').text().trim() ||
                               $('.episode-count').text().trim();
            quickInfo.episodes = episodeCount;
        }
        
        // Ambil trailer
        const trailerUrl = $('.trailerbutton').attr('href') || 
                          $('a[data-fancybox]').attr('href') ||
                          $('a.trailer-link').attr('href') ||
                          $('meta[property="og:video:url"]').attr('content');
        
        // Ambil daftar episode
        const episodes = [];
        $('.episode-list-items .episode-item, .episode-list a, .list-episode a').each((i, el) => {
            const episodeUrl = $(el).attr('href');
            const episodeTitle = $(el).find('.ep-title').text().trim() || 
                               $(el).find('.title-ep').text().trim() ||
                               $(el).text().trim() ||
                               `Episode ${i + 1}`;
            const episodeDate = $(el).find('.ep-date').text().trim() || 
                              $(el).find('.date').text().trim() ||
                              '';
            
            // Ambil nomor episode dari title
            let episodeNumber = episodeTitle.replace(/[^0-9]/g, '');
            if (!episodeNumber) episodeNumber = (i + 1).toString();
            
            // Ambil slug episode
            const episodeSlug = episodeUrl ? episodeUrl.replace(`${ANIME_BASE_URL}/`, '').replace('/', '') : '';
            
            episodes.push({
                episode: episodeNumber,
                title: episodeTitle,
                slug: episodeSlug,
                url: episodeUrl,
                date: episodeDate,
                is_last: episodeTitle.toLowerCase().includes('tamat') || episodeTitle.toLowerCase().includes('end')
            });
        });
        
        // Ambil dari script JSON LD dengan safe handling
        let jsonData = null;
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const content = $(el).html();
                if (content && (content.includes('TVSeries') || content.includes('Movie'))) {
                    jsonData = JSON.parse(content);
                }
            } catch (e) {
                // Abaikan error parsing JSON
            }
        });
        
        // Gunakan data dari JSON jika ada dan valid
        if (jsonData && jsonData.episode && Array.isArray(jsonData.episode)) {
            const jsonEpisodes = jsonData.episode.map(ep => ({
                episode: ep.episodeNumber || ep.position || '',
                title: ep.name || `Episode ${ep.episodeNumber}`,
                url: ep.url,
                slug: ep.url ? ep.url.replace(`${ANIME_BASE_URL}/`, '').replace('/', '') : ''
            }));
            
            // Gabungkan dengan episodes yang sudah ada, prioritaskan dari HTML
            if (episodes.length === 0 && jsonEpisodes.length > 0) {
                episodes.push(...jsonEpisodes);
            }
        }
        
        // Urutkan episodes berdasarkan nomor (descending/biar episode terbaru di atas)
        episodes.sort((a, b) => {
            const numA = parseInt(a.episode) || 0;
            const numB = parseInt(b.episode) || 0;
            return numB - numA;
        });
        
        // Ambil rekomendasi series
        const recommendations = [];
        $('.related .as-anime-card, .recommendations .anime-card, .series-related .item').each((i, el) => {
            const recUrl = $(el).attr('href') || $(el).find('a').attr('href');
            if (!recUrl) return;
            
            const recSlug = recUrl ? recUrl.replace(`${ANIME_BASE_URL}/anime/`, '').replace('/', '') : '';
            const recTitle = $(el).find('.as-anime-title, .title, h3').first().text().trim();
            let recThumbnail = $(el).find('img').attr('src') || 
                             $(el).find('img').attr('data-src') ||
                             $(el).css('background-image')?.replace('url(', '').replace(')', '').replace(/'/g, '').replace(/"/g, '');
            
            if (recThumbnail) {
                if (recThumbnail.startsWith('//')) {
                    recThumbnail = 'https:' + recThumbnail;
                } else if (recThumbnail.startsWith('/')) {
                    recThumbnail = ANIME_BASE_URL + recThumbnail;
                }
            }
            
            const recRating = $(el).find('.as-rating, .rating, .score').text().replace(/[^0-9.]/g, '');
            const recSynopsis = $(el).find('.as-synopsis, .synopsis, .desc').text().trim();
            
            const recGenres = [];
            $(el).find('.as-genre-tag, .genre, .genres span').each((i, genreEl) => {
                recGenres.push($(genreEl).text().trim());
            });
            
            if (recTitle) {
                recommendations.push({
                    title: recTitle,
                    slug: recSlug,
                    thumbnail: recThumbnail || null,
                    url: recUrl,
                    rating: recRating || null,
                    synopsis: recSynopsis || null,
                    genres: recGenres
                });
            }
        });
        
        // Response JSON
        res.json({
            success: true,
            data: {
                title: title || slug.replace(/-/g, ' '),
                english_title: englishTitle || null,
                slug: slug,
                thumbnail: thumbnail || null,
                rating: rating || null,
                type: type || null,
                status: quickInfo.status || (jsonData?.endDate ? 'Finished Airing' : 'Unknown'),
                synopsis: synopsis.substring(0, 500) + (synopsis.length > 500 ? '...' : ''),
                details: details,
                studio: studio || null,
                genres: genres,
                aired: details['Aired'] || null,
                total_episodes: jsonData?.numberOfEpisodes || 
                               quickInfo.episodes?.replace(/[^0-9]/g, '') || 
                               episodes.length.toString(),
                duration: quickInfo.duration || null,
                season: quickInfo.season || null,
                popularity: details['Popularity'] || null,
                members: details['Members'] || null,
                trailer: trailerUrl || null,
                episodes: episodes.slice(0, 50), // Batasi 50 episode teratas
                total_episodes_found: episodes.length,
                recommendations: recommendations.slice(0, 10) // Batasi 10 rekomendasi
            },
            source: {
                name: 'NontonAnimeID',
                url: animeUrl,
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error scraping anime detail:', error.message);
        
        if (error.response) {
            if (error.response.status === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'Anime tidak ditemukan',
                    error: 'Not Found'
                });
            } else if (error.response.status === 403) {
                return res.status(503).json({
                    success: false,
                    message: 'Website sumber memblokir akses. Coba lagi nanti atau gunakan proxy.',
                    error: 'Access Forbidden (403)'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil detail anime',
            error: error.message
        });
    }
});

// /api/anime/watch/mato-seihei-no-slave-2-episode-5
app.get('/api/anime/watch/:animeSlug/:episodeSlug?', async (req, res) => {
    try {
        const { animeSlug, episodeSlug } = req.params;
        
        // Tentukan URL episode
        let episodeUrl;
        if (episodeSlug) {
            // Format: /api/anime/watch/mato-seihei-no-slave-2/episode-5
            episodeUrl = `${ANIME_BASE_URL}/${episodeSlug}/`;
        } else {
            // Jika hanya animeSlug, asumsikan itu adalah slug episode lengkap
            episodeUrl = `${ANIME_BASE_URL}/${animeSlug}/`;
        }
        
        console.log(`Fetching episode: ${episodeUrl}`);
        
        const { data } = await axios.get(episodeUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.google.com/',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        const $ = cheerio.load(data);
        
        // ============= DATA EPISODE =============
        // Ambil judul episode
        const title = $('h1.entry-title').text().trim() || 
                     $('title').text().replace(' - Nonton Anime ID', '').trim();
        
        // Ambil thumbnail episode
        let thumbnail = $('meta[property="og:image"]').attr('content') || 
                       $('.featuredimgs img').attr('src') ||
                       $('img[alt*="Episode"]').attr('src');
        
        if (thumbnail && thumbnail.startsWith('//')) {
            thumbnail = 'https:' + thumbnail;
        }
        
        // Ambil informasi episode dari JSON LD
        let episodeInfo = {};
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                if (json['@type'] === 'TVEpisode') {
                    episodeInfo = {
                        name: json.name,
                        episodeNumber: json.episodeNumber,
                        datePublished: json.datePublished,
                        partOfSeries: json.partOfSeries?.name,
                        seriesUrl: json.partOfSeries?.url
                    };
                }
            } catch (e) {}
        });
        
        // Ambil daftar server video
        const servers = [];
        $('.tabs1.player li.tab-link.serverplayer').each((i, el) => {
            const serverId = $(el).attr('id');
            const serverName = $(el).find('span').text().trim() || $(el).text().trim();
            const dataType = $(el).attr('data-type');
            const isActive = $(el).hasClass('current1');
            
            servers.push({
                id: serverId,
                name: serverName,
                type: dataType,
                is_active: isActive
            });
        });
        
        // Ambil embed URL dari iframe
        let embedUrl = null;
        const activeIframe = $('#videoku iframe, .player_embed iframe').first();
        if (activeIframe.length) {
            embedUrl = activeIframe.attr('src') || activeIframe.attr('data-src');
        }
        
        if (!embedUrl) {
            $('iframe').each((i, el) => {
                const src = $(el).attr('src') || $(el).attr('data-src');
                if (src && src.includes('video-embed')) {
                    embedUrl = src;
                    return false;
                }
            });
        }
        
        // Ambil link download
        const downloadLinks = [];
        $('#download_area .listlink a, .download-links a').each((i, el) => {
            const linkUrl = $(el).attr('href');
            const linkText = $(el).text().trim();
            const quality = linkText.match(/\d+p/i)?.[0] || 'Unknown';
            const host = linkText.replace(quality, '').trim() || linkText;
            
            downloadLinks.push({
                host: host,
                quality: quality,
                url: linkUrl
            });
        });
        
        // Ambil navigasi episode
        const navigation = {
            prev: null,
            next: null,
            all_episodes: null
        };
        
        $('#navigation-episode a, .naveps a').each((i, el) => {
            const link = $(el).attr('href');
            const text = $(el).text().trim();
            
            if (text.includes('Prev') || text.includes('Previous')) {
                navigation.prev = {
                    url: link,
                    title: $(el).attr('title') || 'Previous Episode',
                    slug: link ? link.replace(`${ANIME_BASE_URL}/`, '').replace('/', '') : null
                };
            } else if (text.includes('Next')) {
                navigation.next = {
                    url: link,
                    title: $(el).attr('title') || 'Next Episode',
                    slug: link ? link.replace(`${ANIME_BASE_URL}/`, '').replace('/', '') : null
                };
            } else if (text.includes('All Episode') || text.includes('All Episodes')) {
                navigation.all_episodes = {
                    url: link,
                    title: 'All Episodes',
                    slug: link ? link.replace(`${ANIME_BASE_URL}/anime/`, '').replace('/', '') : null
                };
            }
        });
        
        // Ambil tracking data
        let trackingData = {};
        $('script').each((i, el) => {
            const scriptContent = $(el).html();
            if (scriptContent && scriptContent.includes('episodeToTrack')) {
                const match = scriptContent.match(/const\s+episodeToTrack\s*=\s*(\{.*?\});/s);
                if (match && match[1]) {
                    try {
                        const jsonStr = match[1]
                            .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
                            .replace(/'/g, '"');
                        trackingData = JSON.parse(jsonStr);
                    } catch (e) {}
                }
            }
        });
        
        // ============= DATA DETAIL ANIME =============
        // Dapatkan series slug dari navigation atau tracking
        const seriesSlug = navigation.all_episodes?.slug || 
                          trackingData.seriesUrl?.split('/anime/')[1]?.replace('/', '') || 
                          animeSlug;
        
        let animeDetail = {
            synopsis: null,
            episodes: [],
            total_episodes: 0,
            genres: [],
            status: null,
            rating: null,
            studio: null,
            aired: null,
            duration: null
        };
        
        // Jika ada series slug, scrape detail anime
        if (seriesSlug) {
            try {
                const seriesUrl = `${ANIME_BASE_URL}/anime/${seriesSlug}/`;
                console.log(`Fetching anime detail: ${seriesUrl}`);
                
                const seriesResponse = await axios.get(seriesUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                
                const $series = cheerio.load(seriesResponse.data);
                
                // Ambil sinopsis
                let synopsis = '';
                $series('#tab-synopsis .synopsis-prose p, .synopsis-prose p, .entry-content p').each((i, el) => {
                    synopsis += $series(el).text().trim() + ' ';
                });
                
                if (!synopsis) {
                    synopsis = $series('meta[name="description"]').attr('content') || '';
                }
                
                // Ambil genre
                const genres = [];
                $series('.anime-card__genres .genre-tag, .genres a, .genre-item').each((i, el) => {
                    const genre = $series(el).text().trim();
                    if (genre && !genres.includes(genre)) {
                        genres.push(genre);
                    }
                });
                
                // Ambil rating
                const rating = $series('.anime-card__score .value').text().trim() ||
                              $series('.kotakscore').first().text().trim();
                
                // Ambil status, studio, dll dari details
                let studio = null;
                let status = null;
                let aired = null;
                let duration = null;
                
                $series('.details-list li, .anime-info li').each((i, el) => {
                    const text = $series(el).text().trim();
                    if (text.includes('Studios:')) {
                        studio = text.replace('Studios:', '').trim();
                    } else if (text.includes('Status:') || text.includes('Airing') || text.includes('Finished')) {
                        status = text.replace('Status:', '').trim();
                    } else if (text.includes('Aired:')) {
                        aired = text.replace('Aired:', '').trim();
                    } else if (text.includes('Duration:') || text.includes('min per ep')) {
                        duration = text.replace('Duration:', '').trim();
                    }
                });
                
                // Jika tidak ditemukan, coba dari quick info
                if (!status) {
                    $series('.anime-card__quick-info .info-item').each((i, el) => {
                        const text = $series(el).text().trim();
                        if (text.includes('Finished') || text.includes('Airing')) {
                            status = text;
                        }
                    });
                }
                
                // Ambil daftar episode lengkap
                const episodes = [];
                $series('.episode-list-items .episode-item, .list-episode a').each((i, el) => {
                    const episodeUrl = $series(el).attr('href');
                    const episodeTitle = $series(el).find('.ep-title').text().trim() || 
                                       $series(el).find('.title-ep').text().trim() ||
                                       $series(el).text().trim();
                    const episodeDate = $series(el).find('.ep-date').text().trim() || 
                                      $series(el).find('.date').text().trim();
                    
                    let episodeNumber = episodeTitle.replace(/[^0-9]/g, '');
                    if (!episodeNumber) episodeNumber = (i + 1).toString();
                    
                    const episodeSlug = episodeUrl ? episodeUrl.replace(`${ANIME_BASE_URL}/`, '').replace('/', '') : '';
                    
                    episodes.push({
                        episode: episodeNumber,
                        title: episodeTitle,
                        slug: episodeSlug,
                        url: episodeUrl,
                        date: episodeDate,
                        is_current: episodeUrl === episodeUrl // Tandai episode yang sedang ditonton
                    });
                });
                
                // Urutkan episodes berdasarkan nomor (descending)
                episodes.sort((a, b) => {
                    const numA = parseInt(a.episode) || 0;
                    const numB = parseInt(b.episode) || 0;
                    return numB - numA;
                });
                
                // Tandai episode yang sedang aktif
                const currentEpisodeUrl = episodeUrl;
                episodes.forEach(ep => {
                    ep.is_current = ep.url === currentEpisodeUrl;
                });
                
                animeDetail = {
                    synopsis: synopsis.trim(),
                    episodes: episodes.slice(0, 50), // Batasi 50 episode
                    total_episodes: episodes.length,
                    genres: genres,
                    status: status,
                    rating: rating,
                    studio: studio,
                    aired: aired,
                    duration: duration
                };
                
            } catch (error) {
                console.log('Gagal mengambil detail anime:', error.message);
                // Tetap lanjutkan dengan data episode saja
            }
        }
        
        // Response JSON dengan detail anime
        res.json({
            success: true,
            data: {
                episode: {
                    title: title,
                    episode_number: episodeInfo.episodeNumber || title.match(/Episode\s+(\d+)/i)?.[1] || 'Unknown',
                    series_title: episodeInfo.partOfSeries || trackingData.seriesTitle || title.split('Episode')[0].trim(),
                    series_slug: seriesSlug,
                    thumbnail: thumbnail,
                    description: $('meta[name="description"]').attr('content') || '',
                    date_published: episodeInfo.datePublished || $('time.updated').attr('datetime') || null
                },
                streaming: {
                    servers: servers,
                    current_embed: embedUrl,
                    total_servers: servers.length
                },
                download: {
                    links: downloadLinks,
                    total_links: downloadLinks.length
                },
                navigation: navigation,
                tracking: trackingData,
                anime_detail: {
                    synopsis: animeDetail.synopsis,
                    genres: animeDetail.genres,
                    status: animeDetail.status,
                    rating: animeDetail.rating,
                    studio: animeDetail.studio,
                    aired: animeDetail.aired,
                    duration: animeDetail.duration,
                    episode_list: animeDetail.episodes,
                    total_episodes: animeDetail.total_episodes
                }
            },
            source: {
                name: 'NontonAnimeID',
                episode_url: episodeUrl,
                series_url: navigation.all_episodes?.url || `${ANIME_BASE_URL}/anime/${seriesSlug}/`,
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error scraping episode:', error.message);
        
        if (error.response) {
            if (error.response.status === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'Episode tidak ditemukan',
                    error: 'Not Found'
                });
            } else if (error.response.status === 403) {
                return res.status(503).json({
                    success: false,
                    message: 'Website sumber memblokir akses. Coba lagi nanti atau gunakan proxy.',
                    error: 'Access Forbidden (403)'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil detail episode',
            error: error.message
        });
    }
});








// ============= DONGHUAAAAA =============

function cleanSeriesSlug(url) {
    // Contoh input: /martial-god-asura-season-2-episode-03-subtitle-indonesia/
    // Output: /martial-god-asura-season-2/
    
    // Hapus base URL jika ada
    let slug = url.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '');
    
    // Pola untuk mendeteksi dan menghapus bagian episode
    // Episode bisa dalam format: -episode-123, -ep-123, -episode-123-subtitle-indonesia, dll
    const episodePatterns = [
        /-episode-\d+-.*$/,      // -episode-03-subtitle-indonesia
        /-ep-\d+-.*$/,           // -ep-03-subtitle-indonesia
        /-episode-\d+$/,         // -episode-03
        /-ep-\d+$/,              // -ep-03
        /-episode-\d+-tamat.*$/, // -episode-12-tamat
        /-eps-\d+-.*$/,          // -eps-03-subtitle-indonesia
        /-ep-\d+-tamat.*$/,      // -ep-12-tamat
        /\d+-subtitle-indonesia$/, // 03-subtitle-indonesia
        /-subtitle-indonesia$/,  // -subtitle-indonesia
    ];
    
    let cleanedSlug = slug;
    for (const pattern of episodePatterns) {
        if (pattern.test(cleanedSlug)) {
            cleanedSlug = cleanedSlug.replace(pattern, '');
            break;
        }
    }
    
    // Jika masih ada pola episode yang tersisa, coba hapus dengan regex umum
    if (cleanedSlug.match(/-\d+$/) || cleanedSlug.match(/-\d+-/)) {
        cleanedSlug = cleanedSlug.replace(/-\d+.*$/, '');
    }
    
    // Pastikan tidak ada trailing slash
    return cleanedSlug.replace(/\/$/, '');
}

async function scrapeLatestDonghua(page = 1) {
    try {
        // Tentukan URL berdasarkan page
        let url = DONGHUA_BASE_URL;
        if (page > 1) {
            url = `${DONGHUA_BASE_URL}/page/${page}/`;
        }
        
        console.log(`Fetching donghua page ${page}: ${url}`);
        
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.google.com/'
            }
        });
        
        const $ = cheerio.load(data);
        const latestDonghua = [];
        
        // Ambil dari section Latest Release (listupd normal)
        $('.listupd.normal .excstf article.bs').each((index, element) => {
            const $el = $(element);
            const link = $el.find('a').first();
            const href = link.attr('href') || '';
            const title = link.attr('title') || '';
            
            // Ambil judul series
            const seriesTitle = $el.find('.tt').text().trim() || 
                               $el.find('h2').text().trim() ||
                               title;
            
            // Ambil thumbnail
            let thumbnail = $el.find('img').attr('src') || $el.find('img').attr('data-src');
            if (thumbnail) {
                if (thumbnail.includes('i0.wp.com') && !thumbnail.startsWith('http')) {
                    thumbnail = 'https:' + thumbnail;
                } else if (thumbnail.startsWith('//')) {
                    thumbnail = 'https:' + thumbnail;
                } else if (thumbnail.startsWith('/')) {
                    thumbnail = DONGHUA_BASE_URL + thumbnail;
                }
            }
            
            // Ambil episode (untuk info saja)
            const episode = $el.find('.bt .epx').text().trim() || 'Latest';
            const episodeNumber = episode.replace('Ep', '').trim();
            
            // Ambil status
            const isHot = $el.find('.hotbadge').length > 0;
            const type = $el.find('.typez').text().trim() || 'Donghua';
            const status = $el.find('.status').text().trim() || '';
            
            // Bersihkan slug untuk mendapatkan URL series (bukan episode)
            const seriesSlug = cleanSeriesSlug(href);
            
            // Buat URL series yang benar
            const seriesUrl = `${DONGHUA_BASE_URL}/${seriesSlug}/`;
            
            latestDonghua.push({
                title: seriesTitle,
                latest_episode: episodeNumber,
                episode_raw: episode,
                slug: seriesSlug,
                url: seriesUrl, // URL ke halaman detail series
                original_url: href, // URL asli ke episode (untuk referensi)
                thumbnail: thumbnail || null,
                type: type,
                status: status,
                is_hot: isHot,
                source: 'Anichin'
            });
        });
        
        // Jika tidak ada data dari selector pertama, coba selector alternatif
        if (latestDonghua.length === 0) {
            $('article.bs, .bs').each((index, element) => {
                const $el = $(element);
                const link = $el.find('a').first();
                const href = link.attr('href') || '';
                
                // Skip jika bukan link donghua
                if (!href || href.includes('#') || href === '') return;
                
                const title = link.attr('title') || '';
                const seriesTitle = $el.find('.tt').text().trim() || 
                                   $el.find('h2').text().trim() ||
                                   $el.find('h4').text().trim() ||
                                   title;
                
                let thumbnail = $el.find('img').attr('src') || $el.find('img').attr('data-src');
                if (thumbnail) {
                    if (thumbnail.includes('i0.wp.com') && !thumbnail.startsWith('http')) {
                        thumbnail = 'https:' + thumbnail;
                    } else if (thumbnail.startsWith('//')) {
                        thumbnail = 'https:' + thumbnail;
                    }
                }
                
                const episode = $el.find('.bt .epx').text().trim() || 
                               $el.find('.epx').text().trim() || 
                               'Latest';
                
                const episodeNumber = episode.replace('Ep', '').trim();
                const isHot = $el.find('.hotbadge').length > 0;
                const type = $el.find('.typez').text().trim() || 'Donghua';
                
                // Bersihkan slug untuk mendapatkan URL series
                const seriesSlug = cleanSeriesSlug(href);
                const seriesUrl = `${DONGHUA_BASE_URL}/${seriesSlug}/`;
                
                latestDonghua.push({
                    title: seriesTitle || 'Unknown Title',
                    latest_episode: episodeNumber,
                    episode_raw: episode,
                    slug: seriesSlug,
                    url: seriesUrl,
                    original_url: href,
                    thumbnail: thumbnail || null,
                    type: type,
                    status: '',
                    is_hot: isHot,
                    source: 'Anichin'
                });
            });
        }
        
        // Hilangkan duplikat berdasarkan slug (karena bisa jadi series yang sama muncul di beberapa episode)
        const uniqueDonghua = [];
        const seenSlugs = new Set();
        
        for (const item of latestDonghua) {
            if (!seenSlugs.has(item.slug)) {
                seenSlugs.add(item.slug);
                uniqueDonghua.push(item);
            }
        }
        
        // Cek apakah ada next page
        const hasNextPage = $('a.next.page-numbers, .next.page-numbers, .pagination .next, .hpage .r').length > 0 ||
                           $('.hpage a.r').length > 0 ||
                           $('a:contains("Next")').length > 0;
        
        // Ambil nomor halaman terakhir jika ada
        let lastPage = page;
        $('.page-numbers:not(.next)').each((i, el) => {
            const pageNum = parseInt($(el).text().trim());
            if (!isNaN(pageNum) && pageNum > lastPage) {
                lastPage = pageNum;
            }
        });
        
        return {
            data: uniqueDonghua,
            pagination: {
                current_page: page,
                has_next_page: hasNextPage || uniqueDonghua.length >= 20,
                next_page: hasNextPage ? page + 1 : null,
                last_page: lastPage > page ? lastPage : (hasNextPage ? null : page),
                total_in_page: uniqueDonghua.length
            }
        };
        
    } catch (error) {
        console.error(`Error scraping donghua page ${page}:`, error.message);
        throw error;
    }
}

// /api/donghua/latest?page=2
app.get('/api/donghua/latest', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        // Validasi page
        if (page < 1) {
            return res.status(400).json({
                success: false,
                message: 'Page harus lebih besar dari 0'
            });
        }
        
        const result = await scrapeLatestDonghua(page);
        
        // Ambil data movie dari halaman pertama saja
        let latestMovies = [];
        if (page === 1) {
            try {
                const { data } = await axios.get(DONGHUA_BASE_URL, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                const $ = cheerio.load(data);
                
                $('.bixbox .listupd .excstf article.bs').each((index, element) => {
                    if (index < 5) {
                        const $el = $(element);
                        const link = $el.find('a').first();
                        const href = link.attr('href') || '';
                        const title = link.attr('title') || '';
                        
                        const movieTitle = $el.find('.tt').text().trim() || title;
                        let thumbnail = $el.find('img').attr('src') || $el.find('img').attr('data-src');
                        
                        if (thumbnail) {
                            if (thumbnail.includes('i0.wp.com') && !thumbnail.startsWith('http')) {
                                thumbnail = 'https:' + thumbnail;
                            } else if (thumbnail.startsWith('//')) {
                                thumbnail = 'https:' + thumbnail;
                            }
                        }
                        
                        const type = $el.find('.typez').text().trim() || '';
                        const status = $el.find('.status').text().trim() || '';
                        
                        // Untuk movie, kita juga bersihkan slug
                        const movieSlug = cleanSeriesSlug(href);
                        const movieUrl = `${DONGHUA_BASE_URL}/${movieSlug}/`;
                        
                        if (type === 'Movie' || movieTitle.toLowerCase().includes('movie')) {
                            latestMovies.push({
                                title: movieTitle,
                                slug: movieSlug,
                                url: movieUrl,
                                original_url: href,
                                thumbnail: thumbnail || null,
                                type: type,
                                status: status,
                                source: 'Anichin'
                            });
                        }
                    }
                });
            } catch (movieError) {
                console.log('Gagal mengambil data movie:', movieError.message);
            }
        }
        
        res.json({
            success: true,
            data: {
                latest_releases: result.data.slice(0, limit),
                latest_movies: latestMovies,
                total_releases: result.data.length,
                total_movies: latestMovies.length
            },
            pagination: {
                current_page: result.pagination.current_page,
                next_page: result.pagination.next_page,
                has_next_page: result.pagination.has_next_page,
                last_page: result.pagination.last_page,
                limit: limit,
                total_in_page: result.pagination.total_in_page
            },
            source: {
                name: 'Anichin',
                url: page === 1 ? DONGHUA_BASE_URL : `${DONGHUA_BASE_URL}/page/${page}/`,
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error in /api/donghua/latest:', error.message);
        
        if (error.response) {
            if (error.response.status === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'Halaman tidak ditemukan',
                    error: 'Not Found'
                });
            } else if (error.response.status === 403) {
                return res.status(503).json({
                    success: false,
                    message: 'Website Anichin memblokir akses. Coba lagi nanti.',
                    error: 'Access Forbidden (403)'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data donghua terbaru',
            error: error.message
        });
    }
});

// /api/donghua/detail/over-goddess/
app.get('/api/donghua/detail/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const donghuaUrl = `${DONGHUA_BASE_URL}/${slug}/`;
        
        console.log(`Fetching donghua detail: ${donghuaUrl}`);
        
        const { data } = await axios.get(donghuaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.google.com/'
            }
        });
        
        const $ = cheerio.load(data);
        
        // ========== INFO DASAR ==========
        // Judul
        const title = $('h1.entry-title').text().trim() || 
                     $('.infox h1').text().trim() ||
                     $('title').text().replace(' - Anichin', '').trim();
        
        // Judul alternatif (dari span.alter)
        const alternativeTitle = $('.mindesc .alter').text().trim() || '';
        
        // Thumbnail
        let thumbnail = $('meta[property="og:image"]').attr('content') || 
                       $('.thumb img').attr('src') ||
                       $('.bigcover .ime img').attr('src');
        
        if (thumbnail) {
            if (thumbnail.startsWith('//')) {
                thumbnail = 'https:' + thumbnail;
            } else if (thumbnail.startsWith('/')) {
                thumbnail = DONGHUA_BASE_URL + thumbnail;
            }
        }
        
        // Rating
        let rating = $('.rating strong').text().replace('Rating', '').trim() || 
                    $('.numscore').text().trim() ||
                    $('meta[itemprop="ratingValue"]').attr('content');
        
        // Followers
        const followers = $('.bmc').text().replace('Followed', '').replace('people', '').trim() || '';
        
        // Sinopsis
        let synopsis = '';
        $('.entry-content p, .desc p, .synp .entry-content p').each((i, el) => {
            synopsis += $(el).text().trim() + '\n\n';
        });
        synopsis = synopsis.trim();
        
        // ========== INFORMASI DETAIL ==========
        const details = {};
        
        $('.info-content .spe span').each((i, el) => {
            const text = $(el).text().trim();
            if (text.includes(':')) {
                const [key, value] = text.split(':');
                const cleanKey = key.replace(/[^a-zA-Z0-9 ]/g, '').trim();
                details[cleanKey] = value.trim();
            } else if (text.includes('by:')) {
                // Handle special case untuk posted by
                const parts = text.split('by:');
                details['Posted by'] = parts[1]?.trim() || '';
            }
        });
        
        // Ambil status dari details atau dari elemen lain
        const status = details['Status'] || $('.status').text().trim() || 'Unknown';
        
        // Studio
        const studio = details['Studio'] || '';
        
        // Network/Channel
        const network = details['Network'] || '';
        
        // Released date
        const released = details['Released'] || '';
        
        // Duration
        const duration = details['Duration'] || '';
        
        // Season
        const season = details['Season'] || '';
        
        // Country
        const country = details['Country'] || '';
        
        // Type (Donghua, Movie, etc)
        const type = details['Type'] || $('.typez').first().text().trim() || 'Donghua';
        
        // Total episodes
        const totalEpisodes = details['Episodes'] || '';
        
        // Fansub
        const fansub = details['Fansub'] || '';
        
        // Posted by
        const postedBy = details['Posted by'] || '';
        
        // Released on (date)
        const releasedOn = details['Released on'] || '';
        
        // Updated on
        const updatedOn = details['Updated on'] || '';
        
        // ========== GENRES ==========
        const genres = [];
        $('.genxed a, .genres a, .tags a').each((i, el) => {
            const genre = $(el).text().trim();
            if (genre && !genres.includes(genre)) {
                genres.push(genre);
            }
        });
        
        // ========== TAGS ==========
        const tags = [];
        $('.bottom.tags a, .tags-links a').each((i, el) => {
            const tag = $(el).text().trim();
            if (tag && !tags.includes(tag)) {
                tags.push(tag);
            }
        });
        
        // ========== EPISODE LIST ==========
        const episodes = [];
        
        // Dari daftar episode
        $('.eplister ul li').each((i, el) => {
            const link = $(el).find('a');
            const href = link.attr('href') || '';
            const episodeNum = $(el).find('.epl-num').text().trim();
            const episodeTitle = $(el).find('.epl-title').text().trim();
            const episodeDate = $(el).find('.epl-date').text().trim();
            const subStatus = $(el).find('.epl-sub .status').text().trim() || 'Sub';
            
            // Buat slug episode
            let episodeSlug = href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '');
            
            episodes.push({
                episode: episodeNum,
                title: episodeTitle,
                slug: episodeSlug,
                url: href,
                date: episodeDate,
                sub_status: subStatus
            });
        });
        
        // Jika tidak ada dari selector pertama, coba selector alternatif
        if (episodes.length === 0) {
            $('.list-episode li, .episodelist li').each((i, el) => {
                const link = $(el).find('a');
                const href = link.attr('href') || '';
                const episodeText = link.text().trim();
                
                // Coba ekstrak nomor episode
                let episodeNum = '';
                const match = episodeText.match(/Episode\s+(\d+)/i) || episodeText.match(/Ep\s+(\d+)/i);
                if (match) {
                    episodeNum = match[1];
                }
                
                let episodeSlug = href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '');
                
                episodes.push({
                    episode: episodeNum,
                    title: episodeText,
                    slug: episodeSlug,
                    url: href,
                    date: '',
                    sub_status: 'Sub'
                });
            });
        }
        
        // Urutkan episodes berdasarkan nomor (descending - episode terbaru di atas)
        episodes.sort((a, b) => {
            const numA = parseInt(a.episode) || 0;
            const numB = parseInt(b.episode) || 0;
            return numB - numA;
        });
        
        // ========== NAVIGASI FIRST/LAST EPISODE ==========
        const firstEpisode = episodes.length > 0 ? episodes[episodes.length - 1] : null;
        const latestEpisode = episodes.length > 0 ? episodes[0] : null;
        
        // ========== RECOMMENDATIONS ==========
        const recommendations = [];
        $('.listupd article.bs, .recommended article.bs').each((i, el) => {
            if (i < 5) { // Ambil 5 rekomendasi
                const link = $(el).find('a').first();
                const href = link.attr('href') || '';
                const title = $(el).find('.tt').text().trim() || 
                             $(el).find('h2').text().trim() ||
                             link.attr('title');
                
                let thumbnail = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
                if (thumbnail && thumbnail.startsWith('//')) {
                    thumbnail = 'https:' + thumbnail;
                }
                
                const type = $(el).find('.typez').text().trim() || 'Donghua';
                const status = $(el).find('.status').text().trim() || '';
                
                let recSlug = href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '');
                
                recommendations.push({
                    title: title,
                    slug: recSlug,
                    url: href,
                    thumbnail: thumbnail || null,
                    type: type,
                    status: status
                });
            }
        });
        
        // ========== RESPONSE ==========
        res.json({
            success: true,
            data: {
                // Info dasar
                title: title,
                alternative_title: alternativeTitle,
                slug: slug,
                thumbnail: thumbnail,
                rating: rating,
                followers: followers,
                synopsis: synopsis,
                
                // Detail info
                status: status,
                type: type,
                studio: studio,
                network: network,
                country: country,
                season: season,
                released: released,
                duration: duration,
                total_episodes: totalEpisodes,
                fansub: fansub,
                posted_by: postedBy,
                released_on: releasedOn,
                updated_on: updatedOn,
                
                // Genres & Tags
                genres: genres,
                tags: tags,
                
                // Episode info
                episodes: episodes,
                total_episodes_found: episodes.length,
                first_episode: firstEpisode,
                latest_episode: latestEpisode,
                
                // Rekomendasi
                recommendations: recommendations
            },
            source: {
                name: 'Anichin',
                url: donghuaUrl,
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error scraping donghua detail:', error.message);
        
        if (error.response) {
            if (error.response.status === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'Donghua tidak ditemukan',
                    error: 'Not Found'
                });
            } else if (error.response.status === 403) {
                return res.status(503).json({
                    success: false,
                    message: 'Website Anichin memblokir akses. Coba lagi nanti.',
                    error: 'Access Forbidden (403)'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil detail donghua',
            error: error.message
        });
    }
});

// /api/donghua/watch/soul-land-2-the-unrivaled-tang-sect-episode-131-subtitle-indonesia
app.get('/api/donghua/watch/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const episodeUrl = `${DONGHUA_BASE_URL}/${slug}/`;
        
        console.log(`Fetching donghua episode: ${episodeUrl}`);
        
        const { data } = await axios.get(episodeUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.google.com/'
            }
        });
        
        const $ = cheerio.load(data);
        
        // ========== INFO EPISODE ==========
        // Judul episode
        const title = $('h1.entry-title').text().trim() || 
                     $('meta[property="og:title"]').attr('content') ||
                     $('title').text().replace(' - Anichin', '').trim();
        
        // Thumbnail episode
        let thumbnail = $('meta[property="og:image"]').attr('content') || 
                       $('.tb img').attr('src') ||
                       $('.thumb img').attr('src');
        
        if (thumbnail) {
            if (thumbnail.startsWith('//')) {
                thumbnail = 'https:' + thumbnail;
            } else if (thumbnail.startsWith('/')) {
                thumbnail = DONGHUA_BASE_URL + thumbnail;
            }
        }
        
        // Deskripsi
        const description = $('meta[name="description"]').attr('content') || '';
        
        // Tanggal rilis
        const releaseDate = $('meta[property="article:published_time"]').attr('content') || 
                           $('.updated').first().text().trim() ||
                           $('.year span').text().replace('Released on', '').trim();
        
        // Posted by
        const postedBy = $('.vcard.author .fn a').text().trim() || 
                        $('.year .vcard.author').text().replace('Posted by', '').trim() ||
                        $('meta[property="article:author"]').attr('content')?.split('/').pop() || 'Anichin';
        
        // ========== SERVER STREAMING ==========
        const servers = [];
        
        // Ambil dari select dropdown mirror
        $('select.mirror option').each((i, el) => {
            const value = $(el).attr('value');
            const text = $(el).text().trim();
            const dataIndex = $(el).attr('data-index');
            
            // Skip option pertama yang kosong
            if (i > 0 && value) {
                // Decode base64 untuk mendapatkan iframe URL
                let embedUrl = null;
                try {
                    if (value) {
                        // Base64 decode
                        const decoded = Buffer.from(value, 'base64').toString('utf-8');
                        // Extract src dari iframe
                        const srcMatch = decoded.match(/src=["'](.*?)["']/);
                        if (srcMatch && srcMatch[1]) {
                            embedUrl = srcMatch[1];
                        }
                    }
                } catch (e) {
                    console.log('Error decoding base64:', e.message);
                }
                
                servers.push({
                    name: text,
                    embed_url: embedUrl,
                    original_value: value, // Base64 encoded
                    is_active: i === 1 // Server pertama sebagai active (kecuali option kosong)
                });
            }
        });
        
        // Jika tidak ada dari select, coba dari iframe langsung
        if (servers.length === 0) {
            const iframeSrc = $('#pembed iframe, .player-embed iframe').attr('src');
            if (iframeSrc) {
                servers.push({
                    name: 'Default Server',
                    embed_url: iframeSrc,
                    original_value: null,
                    is_active: true
                });
            }
        }
        
        // ========== INFO SERIES (DARI SIDEBAR) ==========
        const seriesInfo = {
            title: $('.headlist .det h2 a').text().trim() || 
                   $('.single-info .infox h2').text().trim() ||
                   $('a[href*="/anime/"]').not('.breadcrumb a').first().text().trim(),
            series_url: $('.headlist .det h2 a').attr('href') || 
                       $('.single-info .infox h2 a').attr('href') ||
                       '',
            thumbnail: $('.headlist .thumb img').attr('src') || 
                      $('.single-info .thumb img').attr('src') ||
                      thumbnail,
            status: $('.headlist .det span i').text().trim() || 
                   $('.single-info .spe span:contains("Status:")').text().replace('Status:', '').trim() ||
                   'Ongoing',
            episode_progress: $('.headlist .det span').text().trim() || ''
        };
        
        // Ambil slug series dari URL
        if (seriesInfo.series_url) {
            seriesInfo.series_slug = seriesInfo.series_url.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '');
        }
        
        // ========== NAVIGASI EPISODE ==========
        const navigation = {
            prev: null,
            next: null,
            all_episodes: null
        };
        
        $('.naveps.bignav .nvs a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            const ariaLabel = $(el).attr('aria-label') || '';
            
            if (ariaLabel.includes('prev') || text.includes('Prev') || i === 0) {
                navigation.prev = {
                    url: href,
                    slug: href ? href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '') : null,
                    title: $(el).attr('title') || 'Previous Episode'
                };
            } else if (ariaLabel.includes('next') || text.includes('Next') || i === 2) {
                navigation.next = {
                    url: href,
                    slug: href ? href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '') : null,
                    title: $(el).attr('title') || 'Next Episode'
                };
            } else if (text.includes('All Episodes') || ariaLabel.includes('All')) {
                navigation.all_episodes = {
                    url: href,
                    slug: href ? href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '') : null,
                    title: 'All Episodes'
                };
            }
        });
        
        // ========== DAFTAR EPISODE (DARI SIDEBAR) ==========
        const episodeList = [];
        let currentEpisode = '';
        
        // Ambil nomor episode saat ini
        const currentEpisodeMatch = title.match(/Episode\s+(\d+)/i);
        if (currentEpisodeMatch) {
            currentEpisode = currentEpisodeMatch[1];
        }
        
        $('#singlepisode .episodelist li').each((i, el) => {
            const link = $(el).find('a');
            const href = link.attr('href') || '';
            const isSelected = $(el).hasClass('selected');
            
            // Thumbnail episode
            let epThumbnail = $(el).find('.thumbnel img').attr('src');
            if (epThumbnail && epThumbnail.startsWith('//')) {
                epThumbnail = 'https:' + epThumbnail;
            }
            
            // Judul episode
            const epTitle = $(el).find('.playinfo h3').text().trim() || 
                           link.attr('title') ||
                           '';
            
            // Info episode (Eps dan tanggal)
            const epInfo = $(el).find('.playinfo span').text().trim() || '';
            
            // Extract episode number
            let epNumber = '';
            const epMatch = epInfo.match(/Eps?\s+(\d+)/i) || epTitle.match(/Episode\s+(\d+)/i);
            if (epMatch) {
                epNumber = epMatch[1];
            }
            
            // Extract tanggal
            let epDate = '';
            const dateMatch = epInfo.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i);
            if (dateMatch) {
                epDate = dateMatch[0];
            }
            
            episodeList.push({
                episode: epNumber,
                title: epTitle,
                slug: href ? href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '') : '',
                url: href,
                thumbnail: epThumbnail || null,
                date: epDate,
                is_current: isSelected || href === episodeUrl
            });
        });
        
        // Urutkan episodes berdasarkan nomor (descending)
        episodeList.sort((a, b) => {
            const numA = parseInt(a.episode) || 0;
            const numB = parseInt(b.episode) || 0;
            return numB - numA;
        });
        
        // ========== DOWNLOAD LINKS ==========
        const downloadLinks = [];
        
        $('.soraddlx .soraurlx').each((i, el) => {
            const quality = $(el).find('strong').text().trim();
            const link = $(el).find('a');
            const url = link.attr('href');
            const host = link.text().trim();
            
            if (quality && url) {
                downloadLinks.push({
                    quality: quality,
                    host: host,
                    url: url
                });
            }
        });
        
        // Jika tidak ada dari selector pertama, coba selector alternatif
        if (downloadLinks.length === 0) {
            $('.mctnx .soraurlx, .download-links a').each((i, el) => {
                const $el = $(el);
                const url = $el.attr('href');
                const text = $el.text().trim();
                
                // Coba deteksi quality dari teks
                let quality = 'Unknown';
                if (text.match(/360p|480p|720p|1080p|4K/i)) {
                    quality = text.match(/(360p|480p|720p|1080p|4K)/i)[0];
                }
                
                let host = text.replace(quality, '').trim() || 'Mirrored';
                
                downloadLinks.push({
                    quality: quality,
                    host: host,
                    url: url
                });
            });
        }
        
        // ========== INFO TAMBAHAN DARI DESKRIPSI ==========
        const additionalInfo = {
            note: $('.announ').last().text().trim() || '',
            description_note: $('.bixbox.infx p').text().trim() || '',
            keywords: $('.bixbox.mctn h5').text().trim() || ''
        };
        
        // ========== RECOMMENDATIONS ==========
        const recommendations = [];
        $('.listupd article.bs, .recommended article.bs').each((i, el) => {
            if (i < 5) {
                const link = $(el).find('a').first();
                const href = link.attr('href') || '';
                const title = $(el).find('.tt').text().trim() || 
                             $(el).find('h2').text().trim() ||
                             link.attr('title');
                
                let recThumbnail = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
                if (recThumbnail && recThumbnail.startsWith('//')) {
                    recThumbnail = 'https:' + recThumbnail;
                }
                
                const type = $(el).find('.typez').text().trim() || 'Donghua';
                const status = $(el).find('.status').text().trim() || '';
                const episode = $(el).find('.epx').text().trim() || '';
                
                let recSlug = href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '');
                
                recommendations.push({
                    title: title,
                    slug: recSlug,
                    url: href,
                    thumbnail: recThumbnail || null,
                    type: type,
                    status: status,
                    episode: episode
                });
            }
        });
        
        // ========== RESPONSE ==========
        res.json({
            success: true,
            data: {
                // Info episode saat ini
                current_episode: {
                    title: title,
                    slug: slug,
                    url: episodeUrl,
                    thumbnail: thumbnail,
                    description: description,
                    release_date: releaseDate,
                    posted_by: postedBy,
                    episode_number: currentEpisode
                },
                
                // Streaming servers
                streaming: {
                    servers: servers,
                    total_servers: servers.length,
                    current_server: servers.find(s => s.is_active) || (servers.length > 0 ? servers[0] : null)
                },
                
                // Download links
                download: {
                    links: downloadLinks,
                    total_links: downloadLinks.length
                },
                
                // Series info
                series: {
                    title: seriesInfo.title,
                    slug: seriesInfo.series_slug,
                    url: seriesInfo.series_url,
                    thumbnail: seriesInfo.thumbnail,
                    status: seriesInfo.status,
                    episode_progress: seriesInfo.episode_progress,
                    total_episodes: episodeList.length
                },
                
                // Navigation
                navigation: navigation,
                
                // Episode list
                episode_list: episodeList,
                total_episodes: episodeList.length,
                
                // Additional info
                additional_info: additionalInfo,
                
                // Recommendations
                recommendations: recommendations
            },
            source: {
                name: 'Anichin',
                url: episodeUrl,
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error scraping donghua episode:', error.message);
        
        if (error.response) {
            if (error.response.status === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'Episode tidak ditemukan',
                    error: 'Not Found'
                });
            } else if (error.response.status === 403) {
                return res.status(503).json({
                    success: false,
                    message: 'Website Anichin memblokir akses. Coba lagi nanti.',
                    error: 'Access Forbidden (403)'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil detail episode',
            error: error.message
        });
    }
});


// ============= FUNGSI SEARCH =============
async function searchAnime(query, page = 1) {
    try {
        const searchUrl = `${ANIME_BASE_URL}/page/${page}/?s=${encodeURIComponent(query)}`;
        console.log(`Searching anime: ${searchUrl}`);
        
        const { data } = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.google.com/'
            }
        });
        
        const $ = cheerio.load(data);
        const results = [];
        
        // Selector untuk hasil pencarian
        $('.archive .as-anime-card').each((i, el) => {
            const $el = $(el);
            const link = $el.attr('href') || '';
            const title = $el.find('.as-anime-title').text().trim();
            
            // Ambil thumbnail
            let thumbnail = $el.find('img').attr('src') || $el.find('img').attr('data-src');
            if (thumbnail) {
                if (thumbnail.startsWith('//')) {
                    thumbnail = 'https:' + thumbnail;
                } else if (thumbnail.startsWith('/')) {
                    thumbnail = ANIME_BASE_URL + thumbnail;
                }
            }
            
            // Ambil rating
            const rating = $el.find('.as-rating .icon').parent().text().replace('⭐', '').trim();
            
            // Ambil type
            const type = $el.find('.as-type .icon').parent().text().replace('📺', '').trim() || 'Anime';
            
            // Ambil season
            const season = $el.find('.as-season .icon').parent().text().replace('📅', '').trim();
            
            // Ambil sinopsis singkat
            const synopsis = $el.find('.as-synopsis').text().trim();
            
            // Ambil genres
            const genres = [];
            $el.find('.as-genre-tag').each((i, genreEl) => {
                genres.push($(genreEl).text().trim());
            });
            
            // Ambil slug dari URL
            let slug = link.replace(ANIME_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '');
            if (slug.includes('/anime/')) {
                slug = slug.replace('/anime/', '');
            }
            
            results.push({
                title: title,
                slug: slug,
                url: link,
                thumbnail: thumbnail,
                rating: rating,
                type: type,
                season: season,
                synopsis: synopsis,
                genres: genres,
                source: 'NontonAnimeID',
                category: 'anime'
            });
        });
        
        // Cek apakah ada next page
        const hasNextPage = $('.pagination .next, .wp-pagenavi .next').length > 0;
        
        return {
            results: results,
            pagination: {
                current_page: page,
                has_next_page: hasNextPage,
                next_page: hasNextPage ? page + 1 : null,
                total_results: results.length
            }
        };
        
    } catch (error) {
        console.error('Error searching anime:', error.message);
        return {
            results: [],
            pagination: {
                current_page: page,
                has_next_page: false,
                next_page: null,
                total_results: 0,
                error: error.message
            }
        };
    }
}

async function searchDonghua(query, page = 1) {
    try {
        let searchUrl;
        if (page === 1) {
            searchUrl = `${DONGHUA_BASE_URL}/?s=${encodeURIComponent(query)}`;
        } else {
            searchUrl = `${DONGHUA_BASE_URL}/page/${page}/?s=${encodeURIComponent(query)}`;
        }
        
        console.log(`Searching donghua: ${searchUrl}`);
        
        const { data } = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.google.com/'
            }
        });
        
        const $ = cheerio.load(data);
        const results = [];
        
        // Selector untuk hasil pencarian
        $('.listupd article.bs').each((i, el) => {
            const $el = $(el);
            const link = $el.find('a').first();
            const href = link.attr('href') || '';
            const title = link.attr('title') || $el.find('.tt').text().trim();
            
            // Ambil thumbnail
            let thumbnail = $el.find('img').attr('src') || $el.find('img').attr('data-src');
            if (thumbnail) {
                if (thumbnail.includes('i0.wp.com') && !thumbnail.startsWith('http')) {
                    thumbnail = 'https:' + thumbnail;
                } else if (thumbnail.startsWith('//')) {
                    thumbnail = 'https:' + thumbnail;
                }
            }
            
            // Ambil status (hotbadge, ongoing, completed)
            const isHot = $el.find('.hotbadge').length > 0;
            const status = $el.find('.status').text().trim() || 
                          (isHot ? 'Hot' : '');
            
            // Ambil type
            const type = $el.find('.typez').text().trim() || 'Donghua';
            
            // Ambil episode info
            const episode = $el.find('.epx').text().trim() || '';
            
            // Bersihkan slug (hapus bagian episode jika ada)
            let slug = href.replace(DONGHUA_BASE_URL, '').replace(/^\//, '').replace(/\/$/, '');
            
            // Jika slug mengandung "episode", ambil bagian sebelum episode
            if (slug.includes('-episode-')) {
                slug = slug.split('-episode-')[0];
            } else if (slug.includes('-ep-')) {
                slug = slug.split('-ep-')[0];
            }
            
            results.push({
                title: title,
                slug: slug,
                url: href,
                thumbnail: thumbnail,
                type: type,
                status: status,
                episode: episode,
                is_hot: isHot,
                source: 'Anichin',
                category: 'donghua'
            });
        });
        
        // Cek apakah ada next page
        const hasNextPage = $('.pagination .next, .page-numbers.next').length > 0;
        
        // Ambil total pages jika ada
        let lastPage = page;
        $('.page-numbers:not(.next)').each((i, el) => {
            const pageNum = parseInt($(el).text().trim());
            if (!isNaN(pageNum) && pageNum > lastPage) {
                lastPage = pageNum;
            }
        });
        
        return {
            results: results,
            pagination: {
                current_page: page,
                has_next_page: hasNextPage,
                next_page: hasNextPage ? page + 1 : null,
                last_page: lastPage > page ? lastPage : (hasNextPage ? null : page),
                total_results: results.length
            }
        };
        
    } catch (error) {
        console.error('Error searching donghua:', error.message);
        return {
            results: [],
            pagination: {
                current_page: page,
                has_next_page: false,
                next_page: null,
                total_results: 0,
                error: error.message
            }
        };
    }
}

function mergeAndShuffleResults(animeResults, donghuaResults) {
    const merged = [];
    const maxLength = Math.max(animeResults.length, donghuaResults.length);
    
    // Gabungkan dengan pola selang-seling
    for (let i = 0; i < maxLength; i++) {
        if (i < animeResults.length) {
            merged.push(animeResults[i]);
        }
        if (i < donghuaResults.length) {
            merged.push(donghuaResults[i]);
        }
    }
    
    // Acak sedikit agar tidak terlalu terprediksi, tapi tetap mempertahankan pola selang-seling secara umum
    for (let i = 0; i < merged.length; i += 2) {
        // Sesekali tukar posisi jika memungkinkan
        if (i + 1 < merged.length && Math.random() > 0.7) {
            const temp = merged[i];
            merged[i] = merged[i + 1];
            merged[i + 1] = temp;
        }
    }
    
    return merged;
}

// /api/search?q=ling
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        // Validasi query
        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Parameter query (q) diperlukan'
            });
        }
        
        // Validasi page
        if (page < 1) {
            return res.status(400).json({
                success: false,
                message: 'Page harus lebih besar dari 0'
            });
        }
        
        // Lakukan pencarian dari kedua sumber secara paralel
        const [animeResult, donghuaResult] = await Promise.all([
            searchAnime(query, page),
            searchDonghua(query, page)
        ]);
        
        // Gabungkan dan acak hasil
        const mergedResults = mergeAndShuffleResults(animeResult.results, donghuaResult.results);
        
        // Potong sesuai limit
        const paginatedResults = mergedResults.slice(0, limit);
        
        // Hitung total results (untuk estimasi)
        const totalAnime = animeResult.pagination.total_results;
        const totalDonghua = donghuaResult.pagination.total_results;
        const estimatedTotal = totalAnime + totalDonghua;
        
        res.json({
            success: true,
            data: {
                query: query,
                results: paginatedResults,
                total_results: paginatedResults.length,
                estimated_total: estimatedTotal,
                sources: {
                    anime: {
                        count: totalAnime,
                        has_next: animeResult.pagination.has_next_page,
                        next_page: animeResult.pagination.next_page
                    },
                    donghua: {
                        count: totalDonghua,
                        has_next: donghuaResult.pagination.has_next_page,
                        next_page: donghuaResult.pagination.next_page
                    }
                }
            },
            pagination: {
                current_page: page,
                limit: limit,
                has_next_page: animeResult.pagination.has_next_page || donghuaResult.pagination.has_next_page,
                next_page: (animeResult.pagination.has_next_page || donghuaResult.pagination.has_next_page) ? page + 1 : null,
                total_in_page: paginatedResults.length
            },
            source: {
                name: 'Multi-source',
                sources: ['NontonAnimeID', 'Anichin'],
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error in /api/search:', error.message);
        
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan pencarian',
            error: error.message
        });
    }
});

// /api/search/anime?q=ling
app.get('/api/search/anime', async (req, res) => {
    try {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Parameter query (q) diperlukan'
            });
        }
        
        const result = await searchAnime(query, page);
        
        res.json({
            success: true,
            data: {
                query: query,
                results: result.results.slice(0, limit),
                total_results: result.results.length
            },
            pagination: {
                current_page: result.pagination.current_page,
                has_next_page: result.pagination.has_next_page,
                next_page: result.pagination.next_page,
                limit: limit
            },
            source: {
                name: 'NontonAnimeID',
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan pencarian anime',
            error: error.message
        });
    }
});

// /api/search/donghua?q=ling atau /api/search/donghua?q=ling&page=4 dst
app.get('/api/search/donghua', async (req, res) => {
    try {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Parameter query (q) diperlukan'
            });
        }
        
        const result = await searchDonghua(query, page);
        
        res.json({
            success: true,
            data: {
                query: query,
                results: result.results.slice(0, limit),
                total_results: result.results.length
            },
            pagination: {
                current_page: result.pagination.current_page,
                has_next_page: result.pagination.has_next_page,
                next_page: result.pagination.next_page,
                limit: limit
            },
            source: {
                name: 'Anichin',
                scraped_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan pencarian donghua',
            error: error.message
        });
    }
});








// Handle 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint tidak ditemukan'
    });
});

// Start server jika tidak dijalankan di Vercel
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

// Export untuk Vercel
module.exports = app;