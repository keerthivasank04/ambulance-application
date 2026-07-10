import { By } from 'selenium-webdriver';
import BasePage from './BasePage.js';

export default class AdminDashboardPage extends BasePage {
  async open() {
    await super.open('/admin');
  }

  async headerText() {
    return this.textOf(By.css('h1'));
  }

  async isTabVisible(index) {
    const el = await this.findByTestId(`admin-tab-${index}`);
    return el.isDisplayed();
  }
}
