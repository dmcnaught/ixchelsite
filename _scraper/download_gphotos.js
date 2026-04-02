const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const path = require('path');

const ALBUM_604 = 'https://photos.google.com/share/AF1QipMrVd-0QfXWTY7KpD_XyWHqmu3KBbphRxJBhB-5Y09r_KpN84_So1okDrXGy2rbAg?key=RmlMZzNhV1dsSmpMOUQyQWM0Z1JhbExXb1U0Q213';
const ALBUM_603 = 'https://photos.google.com/share/AF1QipO5sLXyzDPHqah8T5AacjehbwCwQl22XOV4R9cmAg5BQCxzg5pne_MqTtPUOi48VA?key=a002SVY1MmQzZkpRejlmN2pTaExMMEl3NnIzYldB';

const imgDir = path.join('/Users/duncanmcnaught/ai/ixchelsite', 'images');
if (!fs.existsSync(imgDir)){
    fs.mkdirSync(imgDir, { recursive: true });
}

async function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 200) {
                res.pipe(fs.createWriteStream(filepath))
                   .on('error', reject)
                   .once('close', () => resolve(filepath));
            } else {
                res.resume();
                reject(new Error(`Request Failed With a Status Code: ${res.statusCode}`));
            }
        }).on('error', reject);
    });
}

async function scrapeAlbum(url, prefix) {
    console.log(`Scraping album: ${url}`);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // Scroll a few times to load lazy images
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
    }
    
    // Google Photos uses img tags or divs with background images, but the main grid is usually a class c-b-p
    const imageLinks = await page.evaluate(() => {
        const links = [];
        // Images in the album view are often set as background images on div tags or as img src.
        // Look for any elements holding the 'lh3.googleusercontent.com' property.
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            let src = el.getAttribute('src');
            if (!src && el.style.backgroundImage) {
                const match = el.style.backgroundImage.match(/url\("?(https:\/\/lh3\.googleusercontent\.com\/[^"]+)"?\)/);
                if (match) src = match[1];
            }
            if (src && src.includes('lh3.googleusercontent.com')) {
                // Remove resizing parameters to get the uncropped/high-res version where possible
                // e.g., =w...-h...-no
                const cleanSrc = src.split('=')[0] + '=w2400-h1800-s-no-gm';
                if (!links.includes(cleanSrc)) {
                    links.push(cleanSrc);
                }
            }
        }
        return links;
    });
    
    console.log(`Found ${imageLinks.length} unique image links for ${prefix}.`);
    
    let counter = 1;
    let savedImages = [];
    for (const imgUrl of imageLinks) {
        // Skip avatar/icon sized images (heuristics if needed, but we forcefully add =w2400)
        try {
            const filename = `${prefix}_${counter.toString().padStart(2, '0')}.jpg`;
            const filepath = path.join(imgDir, filename);
            console.log(`Downloading ${filename}...`);
            await downloadImage(imgUrl, filepath);
            savedImages.push(filename);
            counter++;
        } catch (e) {
            console.error(`Failed to download ${imgUrl}: ${e.message}`);
        }
    }
    
    await browser.close();
    return savedImages;
}

async function main() {
    try {
        const suite604Images = await scrapeAlbum(ALBUM_604, 'suite_604');
        const suite603Images = await scrapeAlbum(ALBUM_603, 'room_603');
        console.log('--- DONE ---');
        console.log('Suite 604 files:', suite604Images);
        console.log('Room 603 files:', suite603Images);
    } catch(err) {
        console.error(err);
    }
}

main();
