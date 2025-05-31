require('dotenv').config();
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const path = require('path');

// .env credentials
const WEB_URL = process.env.WEB_URL;
const WEB_USERNAME = process.env.WEB_USERNAME;
const WEB_PASSWORD = process.env.WEB_PASSWORD;

// Whatsapp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

// QR event
client.on('qr', (qr) => {
    console.log('Escanea este código QR con WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Ready event
client.on('ready', () => {
    console.log('¡Bot listo y conectado!');
});

// --- Start Refactored Screenshot Logic ---

async function _createBrowserAndPage(launchArgs, viewportConfig, userAgent, isMobile) {
    const browser = await puppeteer.launch({
        args: launchArgs,
        headless: 'new',
        defaultViewport: !isMobile ? viewportConfig : null 
    });
    const page = await browser.newPage();

    if (isMobile && viewportConfig && userAgent) {
        await page.emulate({ viewport: viewportConfig, userAgent });
    } else if (viewportConfig && userAgent) {
        await page.setViewport(viewportConfig);
        await page.setUserAgent(userAgent);
    }
    return { browser, page };
}

async function _handleLoginAndNavigation(page, targetUrl, username, password) {
    console.log(`Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: ['networkidle2', 'domcontentloaded'], timeout: 60000 });

    let currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    if (!currentUrl.includes('clusters')) {
        console.log('Initial navigation did not land on clusters. Attempting direct navigation...');
        await page.goto(targetUrl, { waitUntil: ['networkidle2', 'domcontentloaded'], timeout: 30000 });
        currentUrl = page.url();
        console.log(`URL after direct navigation attempt: ${currentUrl}`);
    }

    const hasLoginForm = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
    if (hasLoginForm) {
        console.log('Login form detected, completing...');
        await page.evaluate((user, pass) => {
            const userField = document.querySelector('input[type="text"], input[type="email"], input[name="username"]');
            if (userField) userField.value = user;
            const passField = document.querySelector('input[type="password"]');
            if (passField) passField.value = pass;
        }, username, password);

        await Promise.all([
            page.evaluate(() => {
                const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
                if (submitBtn) submitBtn.click();
                else { const form = document.querySelector('form'); if (form) form.submit(); }
            }),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => console.log('Navigation after submit did not complete as expected or timed out.'))
        ]);
        await page.waitForTimeout(5000); 

        currentUrl = page.url();
        console.log(`URL after login attempt: ${currentUrl}`);
        if (!currentUrl.includes('clusters')) {
            console.log('Login did not redirect to clusters. Attempting direct navigation to clusters...');
            await page.goto(targetUrl, { waitUntil: ['networkidle2', 'domcontentloaded'], timeout: 30000 });
            currentUrl = page.url();
            console.log(`URL after post-login direct navigation attempt: ${currentUrl}`);
        }
    }
    if (!page.url().includes('clusters')) {
        console.warn(`Failed to navigate to a URL containing 'clusters'. Current URL: ${page.url()}`);
    }
}

async function _applyCustomizationsAndTakeScreenshot(page, screenshotPath, customCSS, preScreenshotLogic, screenshotOpts) {
    await page.waitForTimeout(3000); 

    if (customCSS) {
        await page.evaluate((css) => {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }, customCSS);
        await page.waitForTimeout(500); 
    }

    if (preScreenshotLogic) {
        await preScreenshotLogic(page);
    }

    const finalScreenshotOptions = {
        path: screenshotPath,
        fullPage: true,
        type: 'png',
        ...screenshotOpts 
    };
    await page.screenshot(finalScreenshotOptions);
    console.log(`Screenshot saved to ${screenshotPath}`);
}

async function _captureScreenshotBase(config) {
    const {
        screenshotFileName,
        launchArgs,
        viewportConfig,
        userAgent,
        customCSS,
        isMobile,
        screenshotOptions,
        preScreenshotLogic
    } = config;

    const screenshotDir = path.join(__dirname, 'screenshots');
    await fs.ensureDir(screenshotDir);
    const screenshotPath = path.join(screenshotDir, screenshotFileName);

    let browser;
    try {
        const { browser: newBrowser, page } = await _createBrowserAndPage(launchArgs, viewportConfig, userAgent, isMobile);
        browser = newBrowser;

        await _handleLoginAndNavigation(page, WEB_URL, WEB_USERNAME, WEB_PASSWORD);
        await _applyCustomizationsAndTakeScreenshot(page, screenshotPath, customCSS, preScreenshotLogic, screenshotOptions);
        
        await browser.close();
        return screenshotPath;
    } catch (error) {
        console.error(`Error in _captureScreenshotBase for ${screenshotFileName}:`, error.message);
        if (browser) {
            try {
                const pages = await browser.pages();
                if (pages.length > 0 && pages[0]) {
                    const errorScreenshotDir = path.dirname(screenshotPath);
                    const errorScreenshotName = `error_${path.basename(screenshotFileName, '.png')}_${Date.now()}.png`;
                    const errorScreenshotFullPath = path.join(errorScreenshotDir, errorScreenshotName);
                    await pages[0].screenshot({ path: errorScreenshotFullPath, fullPage: true });
                    console.log(`Error screenshot saved to ${errorScreenshotFullPath}`);
                }
            } catch (e) {
                console.error('Failed to take error screenshot:', e.message);
            }
            await browser.close();
        }
        throw error; 
    }
}

async function captureWebScreenshot() {
    const desktopConfig = {
        screenshotFileName: `capture_${Date.now()}.png`,
        launchArgs: [
            '--no-sandbox', '--disable-setuid-sandbox', '--window-size=2560,1440',
            '--font-render-hinting=none', '--disable-gpu-vsync',
            '--disable-skia-runtime-opts', '--high-dpi-support=1'
        ],
        viewportConfig: { width: 2560, height: 1440, deviceScaleFactor: 2.0 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        customCSS: `
            * { text-rendering: geometricPrecision !important; font-smooth: always !important; -webkit-font-smoothing: antialiased !important; }
            img, svg { image-rendering: -webkit-optimize-contrast !important; }
        `,
        isMobile: false,
        screenshotOptions: { omitBackground: true, encoding: 'binary' },
        preScreenshotLogic: null
    };
    return _captureScreenshotBase(desktopConfig);
}

async function captureWebScreenshotMobile() {
    const mobileConfig = {
        screenshotFileName: `mobile_capture_${Date.now()}.png`,
        launchArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
        viewportConfig: { width: 390, height: 844, deviceScaleFactor: 3.0, isMobile: true, hasTouch: true },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        customCSS: `
            * { text-rendering: geometricPrecision !important; -webkit-font-smoothing: antialiased !important; }
        `,
        isMobile: true,
        screenshotOptions: {}, 
        preScreenshotLogic: async (page) => {
            await page.evaluate(() => {
                window.scrollTo(0, 0);
                window.scrollTo(0, document.body.scrollHeight);
                window.scrollTo(0, 0); 
            });
            await page.waitForTimeout(1000);
        }
    };
    return _captureScreenshotBase(mobileConfig);
}

// --- End Refactored Screenshot Logic ---

// Listen for incoming messages
client.on('message', async (message) => {
    const content = message.body.toLowerCase();
    
    // awnser commands
    if (content === '!hola') {
        await message.reply('¡Hola! Envía !ayuda para ver comandos disponibles.');
    } 
    else if (content === '!ayuda') {
        await message.reply(
            '*Comandos:*\n' +
            '!hola - Saludar\n' +
            '!info - Información\n' +
            '!hora - Ver hora actual\n' +
            '!dado - Tirar un dado\n' +
            '!clusters - Capturar pantalla web (versión escritorio)\n' + 
            '!clustersmovil - Capturar pantalla web (versión móvil)'
        );
    }
    else if (content === '!info') {
        await message.reply('Made with ❤️ by Flingocho');
    }
    else if (content === '!hora') {
        await message.reply(`Hora actual: ${new Date().toLocaleTimeString()}`);
    }
    else if (content === '!dado') {
        const num = Math.floor(Math.random() * 6) + 1;
        await message.reply(`🎲 Has sacado: ${num}`);
    }
    else if (content === '!clusters') {
        try {
            await message.reply('Cooking tu screenshot bb <3');
            const screenshotPath = await captureWebScreenshot();
            const media = MessageMedia.fromFilePath(screenshotPath);
            await client.sendMessage(message.from, media, { caption: '🫶🏽 Versión escritorio' });
            await fs.unlink(screenshotPath).catch(() => {});
        } catch (error) {
            await message.reply('❌ Error al capturar pantalla. Intenta más tarde.');
        }
    }
    else if (content === '!clustersmovil') {
        try {
            await message.reply('Preparando captura de pantalla versión móvil...');
            const screenshotPath = await captureWebScreenshotMobile();
            const media = MessageMedia.fromFilePath(screenshotPath);
            await client.sendMessage(message.from, media, { caption: '📱 Versión móvil' });
            await fs.unlink(screenshotPath).catch(() => {});
        } catch (error) {
            await message.reply('❌ Error al capturar pantalla móvil. Intenta más tarde.');
        }
    }
});

// Iniciar el cliente
client.initialize();
console.log('Iniciando bot... Espera el código QR.');