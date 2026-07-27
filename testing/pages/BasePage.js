import { By, until, error as seleniumError } from 'selenium-webdriver';
import { BASE_URL } from '../config/env.js';

const DEFAULT_TIMEOUT = 10000;

export default class BasePage {
  constructor(driver) {
    this.driver = driver;
  }

  testId(id) {
    return By.css(`[data-testid="${id}"]`);
  }

  async open(path = '/') {
    await this.driver.get(`${BASE_URL}${path}`);
  }

  // React can replace a DOM node between "locate" and the next step (e.g.
  // a loading-skeleton -> real-content swap, or a polling-driven re-render),
  // which turns an already-held WebElement reference stale. Retrying the
  // whole locate step on StaleElementReferenceError — rather than reusing
  // one reference across waits — makes this robust to that timing instead
  // of flaking whenever a render happens to land mid-check.
  async find(locator, timeout = DEFAULT_TIMEOUT) {
    const deadline = Date.now() + timeout;
    for (;;) {
      try {
        const el = await this.driver.wait(until.elementLocated(locator), timeout);
        await this.driver.wait(until.elementIsVisible(el), Math.max(1, deadline - Date.now()));
        return el;
      } catch (e) {
        if (e instanceof seleniumError.StaleElementReferenceError && Date.now() < deadline) continue;
        throw e;
      }
    }
  }

  async findByTestId(id, timeout = DEFAULT_TIMEOUT) {
    return this.find(this.testId(id), timeout);
  }

  async click(locator, timeout = DEFAULT_TIMEOUT) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const el = await this.find(locator, Math.max(1, deadline - Date.now()));
      try {
        return await el.click();
      } catch (e) {
        if (e instanceof seleniumError.StaleElementReferenceError && Date.now() < deadline) continue;
        throw e;
      }
    }
  }

  async clickTestId(id, timeout = DEFAULT_TIMEOUT) {
    return this.click(this.testId(id), timeout);
  }

  async type(locator, text, timeout = DEFAULT_TIMEOUT) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const el = await this.find(locator, Math.max(1, deadline - Date.now()));
      try {
        await el.clear();
        return await el.sendKeys(text);
      } catch (e) {
        if (e instanceof seleniumError.StaleElementReferenceError && Date.now() < deadline) continue;
        throw e;
      }
    }
  }

  async typeTestId(id, text, timeout = DEFAULT_TIMEOUT) {
    return this.type(this.testId(id), text, timeout);
  }

  async textOf(locator, timeout = DEFAULT_TIMEOUT) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const el = await this.find(locator, Math.max(1, deadline - Date.now()));
      try {
        return await el.getText();
      } catch (e) {
        if (e instanceof seleniumError.StaleElementReferenceError && Date.now() < deadline) continue;
        throw e;
      }
    }
  }

  async textOfTestId(id, timeout = DEFAULT_TIMEOUT) {
    return this.textOf(this.testId(id), timeout);
  }

  async waitForUrlContains(fragment, timeout = DEFAULT_TIMEOUT) {
    await this.driver.wait(until.urlContains(fragment), timeout);
  }

  async currentUrl() {
    return this.driver.getCurrentUrl();
  }
}
