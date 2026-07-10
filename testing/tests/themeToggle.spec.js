import { expect } from 'chai';
import { createDriver } from '../drivers/driverFactory.js';
import LandingPage from '../pages/LandingPage.js';

describe('Theme toggle', function () {
  let driver;
  let landing;

  before(async function () {
    driver = await createDriver();
    landing = new LandingPage(driver);
  });

  after(async function () {
    await driver.quit();
  });

  it('switches the data-theme attribute when the toggle button is clicked', async function () {
    await landing.open();
    const before = await landing.currentTheme();
    await landing.toggleTheme();
    const after = await landing.currentTheme();
    expect(after).to.not.equal(before);
  });
});
