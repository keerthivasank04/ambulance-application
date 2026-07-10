import { Builder } from 'selenium-webdriver';
import edge from 'selenium-webdriver/edge.js';
import chrome from 'selenium-webdriver/chrome.js';
import { BROWSER, HEADLESS } from '../config/env.js';

export async function createDriver() {
  const builder = new Builder().forBrowser(BROWSER);

  if (BROWSER === 'MicrosoftEdge') {
    const options = new edge.Options();
    if (HEADLESS) options.addArguments('--headless=new');
    options.addArguments('--window-size=1440,900', '--disable-gpu');
    builder.setEdgeOptions(options);
  } else {
    const options = new chrome.Options();
    if (HEADLESS) options.addArguments('--headless=new');
    options.addArguments('--window-size=1440,900', '--disable-gpu');
    builder.setChromeOptions(options);
  }

  // Selenium Manager (bundled with selenium-webdriver 4.6+) auto-resolves
  // the matching driver binary for the installed browser — no manual
  // chromedriver/msedgedriver setup required.
  const driver = await builder.build();
  await driver.manage().setTimeouts({ implicit: 0 });
  return driver;
}
