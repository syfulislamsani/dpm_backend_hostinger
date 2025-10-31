import puppeteer, { Browser } from "puppeteer-core";
import path from "path";

let browser: Browser | null = null;

export async function getBrowserInstance(): Promise<Browser> {
    if (browser && browser.process()) return browser;

    try {
        const pathToChromeLocal = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
        const pathToChrome = "/var/www/chrome/linux-141.0.7390.122/chrome-linux64/chrome";
        browser = await puppeteer.launch({
            executablePath: pathToChromeLocal,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--single-process",
                "--no-zygote",
            ],
            headless: true,
        });
        return browser;
    } catch (err) {
        // console.error("Failed to launch Puppeteer browser instance!");
        // console.error("Error:", err);
        // console.error("Node version:", process.version);
        // console.error("Platform:", process.platform, process.arch);
        // console.error("Env CHROME_PATH:", process.env.CHROME_PATH);
        console.error("Attempted executablePath:", "/var/www/chrome/linux-141.0.7390.122/chrome-linux64/chrome");
        throw err;
    }
}

