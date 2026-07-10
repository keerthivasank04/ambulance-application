import { By } from 'selenium-webdriver';
import BasePage from './BasePage.js';

export default class LandingPage extends BasePage {
  async open() {
    await super.open('/');
  }

  async heroHeadingText() {
    return this.textOf(By.css('body'));
  }

  async goToRequestAmbulance() {
    await this.clickTestId('nav-link-request');
  }

  async goToDriverPortal() {
    await this.clickTestId('nav-link-driver');
  }

  async goToControlRoom() {
    await this.clickTestId('nav-link-admin');
  }

  async toggleTheme() {
    await this.clickTestId('theme-toggle');
  }

  async currentTheme() {
    const html = await this.driver.findElement(By.css('html'));
    return html.getAttribute('data-theme');
  }
}
