import { By } from 'selenium-webdriver';
import BasePage from './BasePage.js';

export default class RequestEmergencyPage extends BasePage {
  async open() {
    await super.open('/request');
  }

  async locationStepHeading() {
    return this.textOf(By.xpath("//h2[text()='Your Location']"));
  }

  async geoErrorText(timeout = 15000) {
    return this.textOfTestId('geo-error', timeout);
  }

  async isStep1ContinuePresent() {
    const els = await this.driver.findElements(this.testId('step1-continue'));
    return els.length > 0;
  }
}
