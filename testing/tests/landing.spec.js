import { expect } from 'chai';
import { createDriver } from '../drivers/driverFactory.js';
import LandingPage from '../pages/LandingPage.js';

describe('Landing page', function () {
  let driver;
  let landing;

  before(async function () {
    driver = await createDriver();
    landing = new LandingPage(driver);
  });

  after(async function () {
    await driver.quit();
  });

  it('loads and displays the 108 emergency ambulance hero section', async function () {
    await landing.open();
    const bodyText = await landing.heroHeadingText();
    expect(bodyText).to.include('108');
    expect(bodyText).to.include('Emergency');
  });

  it('navigates to the Request Ambulance page from the navbar', async function () {
    await landing.open();
    await landing.goToRequestAmbulance();
    await landing.waitForUrlContains('/request');
    const url = await landing.currentUrl();
    expect(url).to.include('/request');
  });

  it('navigates to the Driver Portal from the navbar', async function () {
    await landing.open();
    await landing.goToDriverPortal();
    await landing.waitForUrlContains('/driver');
    const url = await landing.currentUrl();
    expect(url).to.include('/driver');
  });
});
