import { By, until } from 'selenium-webdriver';
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

  async find(locator, timeout = DEFAULT_TIMEOUT) {
    const el = await this.driver.wait(until.elementLocated(locator), timeout);
    await this.driver.wait(until.elementIsVisible(el), timeout);
    return el;
  }

  async findByTestId(id, timeout = DEFAULT_TIMEOUT) {
    return this.find(this.testId(id), timeout);
  }

  async click(locator, timeout = DEFAULT_TIMEOUT) {
    const el = await this.find(locator, timeout);
    await el.click();
  }

  async clickTestId(id, timeout = DEFAULT_TIMEOUT) {
    return this.click(this.testId(id), timeout);
  }

  async type(locator, text, timeout = DEFAULT_TIMEOUT) {
    const el = await this.find(locator, timeout);
    await el.clear();
    await el.sendKeys(text);
  }

  async typeTestId(id, text, timeout = DEFAULT_TIMEOUT) {
    return this.type(this.testId(id), text, timeout);
  }

  async textOf(locator, timeout = DEFAULT_TIMEOUT) {
    const el = await this.find(locator, timeout);
    return el.getText();
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
