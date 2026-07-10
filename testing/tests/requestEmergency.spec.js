import { expect } from 'chai';
import { createDriver } from '../drivers/driverFactory.js';
import RequestEmergencyPage from '../pages/RequestEmergencyPage.js';

describe('Request Emergency form', function () {
  let driver;
  let page;

  before(async function () {
    driver = await createDriver();
    page = new RequestEmergencyPage(driver);
  });

  after(async function () {
    await driver.quit();
  });

  it('starts on the location step and blocks progress without granted location access', async function () {
    this.timeout(25000);
    await page.open();
    const heading = await page.locationStepHeading();
    expect(heading).to.equal('Your Location');

    // Headless/automated sessions have no granted geolocation permission,
    // so the app's own permission-denied error path should surface.
    const error = await page.geoErrorText(20000);
    expect(error).to.not.be.empty;
    expect(await page.isStep1ContinuePresent()).to.be.false;
  });
});
