const URL = require('url');
const utils = require('@utils');
const loginPage = require('@page-objects/default/login/login.wdio.page');
const commonPage = require('@page-objects/default/common/common.wdio.page');
const placeFactory = require('@factories/cht/contacts/place');
const userFactory = require('@factories/cht/users/users');

describe('Service worker cache', () => {
  const DEFAULT_TRANSLATIONS = {
    'sync.now': 'Sync now',
    'sidebar_menu.title': 'Menu',
    'sync.status.not_required': 'All reports synced',
  };

  // global caches fetch Response navigator
  const getCachedRequests = async (raw) => {
    const cacheDetails = await browser.executeAsync(async (callback) => {
      const cacheNames = await caches.keys();
      const cache = await caches.open(cacheNames[0]);
      const cachedRequests = await cache.keys();
      const cachedRequestSummary = cachedRequests.map(req => ({ url: req.url }));
      callback({
        name: cacheNames[0],
        requests: cachedRequestSummary,
      });
    });

    if (raw) {
      return cacheDetails;
    }

    const urls = cacheDetails.requests.map(request => URL.parse(request.url).pathname);
    urls.sort();
    return { name: cacheDetails.name, urls };
  };

  const stubAllCachedRequests = () => browser.executeAsync(async (callback) => {
    const cacheNames = await caches.keys();
    const cache = await caches.open(cacheNames[0]);
    const cachedRequests = await cache.keys();
    await Promise.all(cachedRequests.map(request => cache.put(request, new Response('cache'))));
    callback();
  });

  const doFetch = (path, headers) => browser.executeAsync(async (innerPath, innerHeaders, callback) => {
    const result = await fetch(innerPath, { headers: innerHeaders });
    callback({
      body: await result.text(),
      ok: result.ok,
      status: result.status,
    });
  }, path, headers);

  const unregisterServiceWorkerAndWipeAllCaches = () => browser.executeAsync(async (callback) => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    registrations.forEach(registration => registration.unregister());

    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      await caches.delete(name);
    }

    callback();
  });

  const district = placeFactory.generateHierarchy(['district_hospital']).get('district_hospital');
  const chw = userFactory.build({ place: district._id });

  const login = async () => {
    await loginPage.login(chw);
    await commonPage.waitForPageLoaded();
  };

  const isLoggedIn = async () => {
    const tab = await commonPage.tabsSelector.messagesTab();
    return await tab.isExisting();
  };

  const loginIfNeeded = async () => {
    await browser.throttle('online');
    if (!await isLoggedIn()) {
      await login();
    }
  };

  before(async () => {
    await utils.saveDoc(district);
    await utils.createUsers([chw]);
    await login();
  });

  beforeEach(async () => {
    await loginIfNeeded();
  });

  afterEach(async () => {
    await utils.revertSettings(true);
  });

  after(async () => {
    await utils.deleteUsers([chw]);
    await utils.revertDb([/^form:/], true);
  });

  it('confirm initial list of cached resources', async () => {
    const cacheDetails = await getCachedRequests();

    expect(cacheDetails.name.startsWith('cht-precache-v2-')).to.be.true;
    expect(cacheDetails.urls.sort()).to.have.members([
      '/',
      '/audio/alert.mp3',
      '/deploy-info.json',
      '/extension-libs',
      '/fontawesome-webfont.woff2',
      '/fonts/NotoSans-Bold.ttf',
      '/fonts/NotoSans-Regular.ttf',
      '/fonts/enketo-icons-v2.woff',
      '/img/cht-logo-light.png',
      '/img/icon-chw-selected.svg',
      '/img/icon-chw.svg',
      '/img/icon-close.svg',
      '/img/icon-nurse-selected.svg',
      '/img/icon-nurse.svg',
      '/img/icon-pregnant-selected.svg',
      '/img/icon-pregnant.svg',
      '/img/icon-filter.svg',
      '/img/icon-check.svg',
      '/img/icon.png',
      '/img/icon-back.svg',
      '/img/layers.png',
      '/login/auth-utils.js',
      '/login/images/hide-password.svg',
      '/login/images/show-password.svg',
      '/login/lib-bowser.js',
      '/login/password-reset.js',
      '/login/script.js',
      '/login/style.css',
      '/main.js',
      '/manifest.json',
      '/medic/_design/medic/_rewrite/',
      '/medic/login',
      '/medic/password-reset',
      '/polyfills.js',
      '/runtime.js',
      '/scripts.js',
      '/styles.css',
    ].sort());
  });

  it('branding updates trigger login page refresh', async () => {
    const waitForLogs = await utils.waitForApiLogs(utils.SW_SUCCESSFUL_REGEX);
    const branding = await utils.getDoc('branding');
    branding.title = 'Not Medic';
    await utils.saveDoc(branding);
    await waitForLogs.promise;

    await commonPage.sync({ expectReload: true, serviceWorkerUpdate: true });
    await browser.throttle('offline'); // make sure we load the login page from cache
    await commonPage.logout();
    expect(await browser.getTitle()).to.equal('Not Medic');
  });

  it('login page translation updates trigger login page refresh', async () => {
    const waitForLogs = await utils.waitForApiLogs(utils.SW_SUCCESSFUL_REGEX);
    await utils.addTranslations('en', {
      'User Name': 'NotUsername',
      'login': 'NotLogin',
    });
    await waitForLogs.promise;

    await commonPage.sync({ expectReload: true, serviceWorkerUpdate: true });
    await browser.throttle('offline'); // make sure we load the login page from cache
    await commonPage.logout();

    expect(await loginPage.labelForUser().getText()).to.equal('NotUsername');
    expect(await loginPage.loginButton().getText()).to.equal('NotLogin');
  });

  it('adding new languages triggers login page refresh', async () => {
    const languageCode = 'ro';
    await utils.enableLanguage(languageCode);
    await commonPage.sync({ expectReload: true, serviceWorkerUpdate: true });

    const waitForLogs = await utils.waitForApiLogs(utils.SW_SUCCESSFUL_REGEX);
    await utils.addTranslations(languageCode, {
      ...DEFAULT_TRANSLATIONS,
      'User Name': 'Utilizator',
      'Password': 'Parola',
      'login': 'Autentificare',
    });
    await waitForLogs.promise;

    await commonPage.sync({ expectReload: true, serviceWorkerUpdate: true });
    await commonPage.logout();

    await loginPage.changeLanguage(languageCode, 'Utilizator');

    expect(await loginPage.labelForUser().getText()).to.equal('Utilizator');
    expect(await loginPage.loginButton().getText()).to.equal('Autentificare');
    expect(await loginPage.labelForPassword().getText()).to.equal('Parola');
  });

  it('other translation updates do not trigger a login page refresh', async () => {
    await commonPage.sync({ expectReload: true, serviceWorkerUpdate: true });

    const cacheDetails = await getCachedRequests(true);

    const waitForLogs = await utils.waitForApiLogs(utils.SW_SUCCESSFUL_REGEX);
    await utils.addTranslations('en', {
      ...DEFAULT_TRANSLATIONS,
      'ran': 'dom',
      'some': 'thing',
    });
    await waitForLogs.promise;
    await commonPage.sync({ expectReload: true, serviceWorkerUpdate: true });

    const updatedCacheDetails = await getCachedRequests(true);

    // login page has the same hash
    const initial = cacheDetails.requests.find(request => request.url.startsWith('/medic/login'));
    const updated = updatedCacheDetails.requests.find(request => request.url.startsWith('/medic/login'));
    expect(initial).to.deep.equal(updated);
  });

  it('should load the page while offline', async () => {
    await browser.throttle('offline');
    await browser.refresh();
    await commonPage.tabsSelector.analyticsTab().waitForDisplayed();
    await browser.throttle('online');
  });

  it('confirm fetch yields cached result', async () => {
    const expectCachedState = async (expectCached, path, headers = {}) => {
      const result = await doFetch(path, headers);
      expect(result.body === 'cache').to.eq(expectCached, JSON.stringify({ path, headers }, null, 2));
    };

    try {
      const { urls: initialCachedUrls } = await getCachedRequests();
      await stubAllCachedRequests();

      await expectCachedState(true, '/');
      await expectCachedState(true, '/', {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*!/!*;' +
        'q=0.8,application/signed-exchange;v=b3'
      });

      await expectCachedState(true, '/medic/login');
      await expectCachedState(true, '/medic/login', {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*!/!*;' +
        'q=0.8,application/signed-exchange;v=b3'
      });
      await expectCachedState(true, '/medic/login?redirect=place&username=user');

      await expectCachedState(true, '/medic/_design/medic/_rewrite/');
      await expectCachedState(true, '/medic/_design/medic/_rewrite/', {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*!/!*;' +
        'q=0.8,application/signed-exchange;v=b3'
      });

      // no part of syncing is cached
      await expectCachedState(false, '/dbinfo', { 'Accept': 'application/json' });
      await expectCachedState(false, '/medic/_changes?style=all_docs&limit=100');

      // confirm no additional requests were added into the cache
      const { urls: resultingCachedUrls } = await getCachedRequests();

      expect(resultingCachedUrls).to.deep.eq(initialCachedUrls);
    } finally {
      // since we've broken the cache. for sw registration
      await unregisterServiceWorkerAndWipeAllCaches();
    }
  });
});
