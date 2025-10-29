import puppeteer, { Browser } from "puppeteer-core";
import path from "path";

let browser: Browser | null = null;

export async function getBrowserInstance(): Promise<Browser> {
	if (browser && browser.process() !== null) return browser;

	browser = await puppeteer.launch({
		executablePath: "/var/www/chrome/linux-141.0.7390.122/chrome-linux64/chrome", // <-- your installed chrome path
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
}
