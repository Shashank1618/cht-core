const utils = require('@utils');
const commonElements = require('@page-objects/default/common/common.wdio.page');
const reportsPage = require('@page-objects/default/reports/reports.wdio.page');
const loginPage = require('@page-objects/default/login/login.wdio.page');
const reportFactory = require('@factories/cht/reports/generic-report');
const personFactory = require('@factories/cht/contacts/person');

describe('Bulk delete reports', () => {
  const docs = [
    reportFactory
      .report()
      .build({
        fields: { lmp_date: 'Feb 3, 2016' },
        form: 'P',
        content_type: 'xml',
        contact: { _id: '3305E3D0-2970-7B0E-AB97-C3239CD22D32' },
        reported_date: 1462333250374,
        from: '+555',
      }),
    reportFactory
      .report()
      .build({
        fields: { lmp_date: 'Feb 15, 2016' },
        form: 'P',
        content_type: 'xml',
        contact: { _id: '3305E3D0-2970-7B0E-AB97-C3239CD22D32' },
        reported_date: 1462338250374,
        from: '+555',
      }),
    reportFactory
      .report()
      .build({
        fields: { ok: 'Yes!' },
        form: 'V',
        content_type: 'xml',
        contact: { _id: '3305E3D0-2970-7B0E-AB97-C3239CD22D32' },
        reported_date: 1462538250374,
        from: '+555',
      }),
    personFactory.build({ phone: '+555', _id: '3305E3D0-2970-7B0E-AB97-C3239CD22D32', reported_date: 1462538250374 })
  ];

  const savedUuids = [];
  before(async () => {
    await loginPage.cookieLogin();
    const results = await utils.saveDocs(docs);
    results.forEach(result => savedUuids.push(result.id));
  });

  it('should select, deselect and delete only selected reports', async () => {
    await commonElements.goToReports();

    const selectAllResult = await reportsPage.selectAll();
    expect(selectAllResult.countLabel).to.equal('3 records selected');
    expect(selectAllResult.selectedCount).to.equal(3);

    const deselectAllResult = await reportsPage.deselectAll();
    expect(deselectAllResult.selectedCount).to.equal(0);

    const selectSomeResult = await reportsPage.selectReports([ savedUuids[0], savedUuids[2] ]);
    expect(selectSomeResult.countLabel).to.equal('2 records selected');
    expect(selectSomeResult.selectedCount).to.equal(2);

    const deselectSomeResult = await reportsPage.deselectReports([ savedUuids[0] ]);

    expect(deselectSomeResult.countLabel).to.equal('1 record selected');
    expect(deselectSomeResult.selectedCount).to.equal(1);

    await reportsPage.expandSelectedReportSummary();
    await reportsPage.collapseSelectedReportSummary();

    await reportsPage.deleteSelectedReports();
    expect((await reportsPage.reportsListDetails()).length).to.equal(2);
    expect(await reportsPage.leftPanelSelectors.reportByUUID(savedUuids[0]).isDisplayed()).to.be.true;
    expect(await reportsPage.leftPanelSelectors.reportByUUID(savedUuids[1]).isDisplayed()).to.be.true;
    expect(await reportsPage.leftPanelSelectors.reportByUUID(savedUuids[2]).isDisplayed()).to.be.false;
  });
});
