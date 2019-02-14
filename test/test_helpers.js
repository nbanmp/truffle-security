const assert = require('assert');
const proxyquire = require('proxyquire');
const rewire = require('rewire');
const fs = require('fs');
const armlet = require('armlet');
const sinon = require('sinon');
const trufstuf = require('../lib/trufstuf');
const mythx = require('../lib/mythx');
const rewiredHelpers = rewire('../helpers');
const util = require('util');


async function assertThrowsAsync(fn, message) {
    let f = () => {};
    try {
        await fn();
    } catch(e) {
        f = () => { throw e; };
    } finally {
        assert.throws(f, message);
    }
}

describe('helpers.js', function() {
    let helpers;

    function compareTest(line1, col1, line2, col2, expect) {
        const res = helpers.compareLineCol(line1, col1, line2, col2);
        if (expect === '=') {
            assert.ok(res === 0);
        } else if (expect === '<') {
            assert.ok(res < 0);
        } else if (expect === '>') {
            assert.ok(res > 0);
        } else {
            assert.throws(`invalid test expect symbol ${expect}; '=', '<', or '>' expected`);
        }
    }

    describe('test helper functions', () => {
        beforeEach(function () {
            helpers = proxyquire('../helpers', {});
        });

        it('should call printVersion', async () => {
            const stubAPI = sinon.stub(armlet, 'ApiVersion').returns({ 'api': '1.0.0' });
            const stubLog = sinon.stub(console, 'log');
            await helpers.printVersion();
            assert.ok(stubAPI.called);
            assert.ok(stubLog.called);
            stubLog.restore();
            stubAPI.restore();
        });

        it('should display helpMessage', async () => {
            const stubLog = sinon.stub(console, 'log');
            await helpers.printHelpMessage();
            assert.ok(stubLog.called);
            stubLog.restore();
        });

        it('should compare two line/column pairs properly', () => {
            const expected = [
                [1, 5, 1, 5, '='],
                [1, 4, 1, 5, '<'],
                [2, 4, 1, 5, '>'],
                [1, 6, 1, 5, '>'],
                [1, 6, 2, 4, '<']];
            for (const t of expected) {
                compareTest(t[0], t[1], t[2], t[3], t[4]);
            }
        }); 

        it('should sort and convert object to a string', () => {
            const res = helpers.versionJSON2String({ mythx: '1.0.1', 'solc': '0.5.0', 'api': '1.0.0' });
            assert.equal(res, 'api: 1.0.0, mythx: 1.0.1, solc: 0.5.0');
        })
    });

    describe('analyze', () => {
        let loggerStub;
        let config;
        let getTruffleBuildJsonFilesStub;

        let contractsCompileStub;
        let doReportStub;
        let getNotFoundContractsStub;
        let doAnalysisStub;
        let ghettoReportStub;
        let getIssues;
            

        beforeEach(() => {
            getTruffleBuildJsonFilesStub = sinon.stub(trufstuf, 'getTruffleBuildJsonFiles');
            contractsCompileStub = sinon.stub();
            doReportStub = sinon.stub();
            getNotFoundContractsStub = sinon.stub();
            doAnalysisStub = sinon.stub();
            loggerStub = sinon.stub();
            warnStub = sinon.stub();
            ghettoReportStub = sinon.stub();
            getIssues = sinon.stub(armlet.Client.prototype, 'getIssues');

            config = {
                contracts_build_directory: '/build/contracts',
                contracts_directory: '/contracts',
                _: [],
                logger: {
                    log: loggerStub,
                    warn: warnStub,
                },
                style: 'stylish',
            };

            helpers = rewire('../helpers');
            helpers.__set__('doAnalysis', doAnalysisStub);
            helpers.__set__('getNotFoundContracts', getNotFoundContractsStub);
            helpers.__set__('contractsCompile', contractsCompileStub);
            helpers.__set__('doReport', doReportStub);
            helpers.__set__('ghettoReport', ghettoReportStub);
        });

        afterEach(() => {
            getTruffleBuildJsonFilesStub.restore();
            getIssues.restore();
        });
        
        it('should return error when passed value for limit is not a number', async () => {
            config.limit = 'test';
            await helpers.analyze(config);
            assert.equal(loggerStub.getCall(0).args[0], 'Rate limit value should be a number; got test.')
        });

        it('should return error when limit is value is out of acceptible range', async () => {
            config.limit = 20;
            doAnalysisStub.resolves({ objects: [], errors: [] });
            await helpers.analyze(config);
            assert.equal(warnStub.getCall(0).args[0], 'Rate limit value should be between at most 10; got 20. Keeping default value.')
        });

        it('should call doAnalyze and report issues', async () => {
            doAnalysisStub.resolves({ objects: 1, errors: 3 });
            getTruffleBuildJsonFilesStub.resolves(['test.json']);
            getNotFoundContractsStub.returns([])

            await helpers.analyze(config);
            assert.ok(getTruffleBuildJsonFilesStub.calledWith(config.contracts_build_directory));
            assert.ok(doAnalysisStub.called);
            assert.ok(getNotFoundContractsStub.calledWith(1, null));
            assert.ok(doReportStub.calledWith(config, 1, 3, []));
        });

        it('should call getIssues when uuid is provided', async () => {
            config.uuid = 'test';
            await helpers.analyze(config);
            assert.ok(getIssues.called);
            assert.ok(ghettoReportStub.called);
        });

        it('should show error when getIssues break', async () => {
            config.uuid = 'test';
            getIssues.throws('Error')
            await helpers.analyze(config);
            assert.ok(getIssues.called);
            assert.ok(loggerStub.getCall(0).args[0], 'Error');
        });
    });

    describe('Armlet authentication analyze', () => {
        let readFileStub;
        let getTruffleBuildJsonFilesStub;
        let initialEnVars;

        const buildJson = JSON.stringify({
            contractName: 'TestContract',
            ast: {
                absolutePath: '/test/build/contracts/TestContract.json'
            },
            deployedBytecode: '0x6080604052',
            sourcePath: '/test/contracts/TestContract/TestContract.sol',
        });

        const buildJson2 = JSON.stringify({
            contractName: 'OtherContract',
            ast: {
                absolutePath: '/test/build/contracts/OtherContract.json'
            },
            deployedBytecode: '0x6080604052',
            sourcePath: '/test/contracts/OtherContract/OtherContract.sol',
        });

        beforeEach(function () {
            // Store initial environment variables
            initialEnVars = {
                MYTHX_PASSWORD: process.env.MYTHX_PASSWORD,
                MYTHX_API_KEY: process.env.MYTHX_API_KEY,
                MYTHX_EMAIL: process.env.MYTHX_EMAIL,
                MYTHX_ETH_ADDRESS: process.env.MYTHX_ETH_ADDRESS,
            };

            // clear envronment variables for tests
            delete process.env.MYTHX_PASSWORD;
            delete process.env.MYTHX_API_KEY;
            delete process.env.MYTHX_EMAIL;
            delete process.env.MYTHX_ETH_ADDRESS;

            getTruffleBuildJsonFilesStub = sinon
                .stub(trufstuf, 'getTruffleBuildJsonFiles')
                .resolves(['/test/build/contracts/TestContract.json', '/test/build/contracts/OtherContract.json']);

            readFileStub = sinon.stub(fs, 'readFile');
            readFileStub.onFirstCall().yields(null, buildJson);
            readFileStub.onSecondCall().yields(null, buildJson2);

            helpers = proxyquire('../helpers', {
                fs: {
                    readFile: readFileStub,
                },
                trufstuf: {
                    getTruffleBuildJsonFiles: getTruffleBuildJsonFilesStub,
                }
            });
        });

        afterEach(function () {
            process.env.MYTHX_PASSWORD = initialEnVars.MYTHX_PASSWORD;
            process.env.MYTHX_API_KEY = initialEnVars.MYTHX_API_KEY;
            process.env.MYTHX_EMAIL = initialEnVars.MYTHX_EMAIL;
            process.env.MYTHX_ETH_ADDRESS = initialEnVars.MYTHX_ETH_ADDRESS;
            initialEnVars = null;
            readFileStub.restore();
            getTruffleBuildJsonFilesStub.restore();
        });

        it('it should group eslint issues by filenames', () => {
            const issues = [{
                errorCount: 1,
                warningCount: 1,
                fixableErrorCount: 0,
                fixableWarningCount: 0,
                filePath: 'contract.sol',
                messages: [
                    'message 1',
                    'message 2',
                ]
            }, {
                errorCount: 0,
                warningCount: 1,
                fixableErrorCount: 0,
                fixableWarningCount: 0,
                filePath: '/tmp/test_dir/contract2.sol',
                messages: [
                    'message 3'
                ]
            }, {
                errorCount: 0,
                warningCount: 1,
                fixableErrorCount: 0,
                fixableWarningCount: 0,
                filePath: '/tmp/test_dir/contract.sol',
                messages: [
                    'message 4'
                ]
            }];

            const result = rewiredHelpers.__get__('groupEslintIssuesByBasename')(issues);
            assert.deepEqual(result, [{
                errorCount: 1,
                warningCount: 2,
                fixableErrorCount: 0,
                fixableWarningCount: 0,
                filePath: 'contract.sol',
                messages: [
                    'message 1',
                    'message 2',
                    'message 4',
                ]
            }, {
                errorCount: 0,
                warningCount: 1,
                fixableErrorCount: 0,
                fixableWarningCount: 0,
                filePath: '/tmp/test_dir/contract2.sol',
                messages: [
                    'message 3'
                ]
            }]);
        });
    });

    describe('doAnalysis', () => {
        let armletClient, stubAnalyze, debuggerStub;

        beforeEach(() => {
            armletClient = new armlet.Client({ apiKey: 'test' });
            stubAnalyze = sinon.stub(armletClient, 'analyzeWithStatus');
            debuggerStub = sinon.stub();
        });

        afterEach(() => {
            stubAnalyze.restore();
            stubAnalyze = null;
        });

        it('should return 1 mythXIssues object and no errors', async () => {
            const doAnalysis = rewiredHelpers.__get__('doAnalysis');
            const config = {
                _: [],
                debug: true,
                logger: {debug: debuggerStub},
                style: 'test-style',
            }
            const jsonFiles = [
                `${__dirname}/sample-truffle/simple_dao/build/contracts/SimpleDAO.json`,
            ];

            const simpleDaoJSON = await util.promisify(fs.readFile)(jsonFiles[0], 'utf8');
            const mythXInput = mythx.truffle2MythXJSON(JSON.parse(simpleDaoJSON));
            stubAnalyze.resolves({
                issues: [{
                    'sourceFormat': 'evm-byzantium-bytecode',
                    'sourceList': [
                        `${__dirname}/sample-truffle/simple_dao/contracts/SimpleDAO.sol`
                    ],
                    'sourceType': 'raw-bytecode',
                    'issues': [{
                        'description': {
                            'head': 'Head message',
                            'tail': 'Tail message'
                        },
                        'locations': [{
                            'sourceMap': '444:1:0'
                        }],
                        'severity': 'High',
                        'swcID': 'SWC-000',
                        'swcTitle': 'Test Title'
                    }],
                    'meta': {
                        'selected_compiler': '0.5.0',
                        'error': [],
                        'warning': []
                    }
                }],
                status: { status: 'Finished' },
            });
            const results = await doAnalysis(armletClient, config, jsonFiles);
            mythXInput.analysisMode = 'quick';
            assert.ok(stubAnalyze.calledWith({
                data: mythXInput,
                timeout: 120000,
                clientToolName: 'truffle',
            }));
            assert.equal(results.errors.length, 0);
            assert.equal(results.objects.length, 1);
        });

        it('should return 0 mythXIssues objects and 1 error', async () => {
            const doAnalysis = rewiredHelpers.__get__('doAnalysis');
            const config = {
                _: [],
                debug: true,
                logger: {debug: debuggerStub},
                style: 'test-style',
            }
            const jsonFiles = [
                `${__dirname}/sample-truffle/simple_dao/build/contracts/SimpleDAO.json`,
            ];
            stubAnalyze.resolves({
                issues: [],
                status: { status: 'Error'},
            });
            const simpleDaoJSON = await util.promisify(fs.readFile)(jsonFiles[0], 'utf8');
            const mythXInput = mythx.truffle2MythXJSON(JSON.parse(simpleDaoJSON));
            const results = await doAnalysis(armletClient, config, jsonFiles);
            mythXInput.analysisMode = 'quick';
            assert.ok(stubAnalyze.calledWith({
                data: mythXInput,
                timeout: 120000,
                clientToolName: 'truffle',
            }));
            assert.equal(results.errors.length, 1);
            assert.equal(results.objects.length, 0);
        });

        it('should return 1 mythXIssues object and 1 error', async () => {
            const doAnalysis = rewiredHelpers.__get__('doAnalysis');
            const config = {
                _: [],
                debug: true,
                logger: {debug: debuggerStub},
                style: 'test-style',
            }
            const jsonFiles = [
                `${__dirname}/sample-truffle/simple_dao/build/contracts/SimpleDAO.json`,
                `${__dirname}/sample-truffle/simple_dao/build/contracts/SimpleDAO.json`,
            ];

            const simpleDaoJSON = await util.promisify(fs.readFile)(jsonFiles[0], 'utf8');
            const mythXInput = mythx.truffle2MythXJSON(JSON.parse(simpleDaoJSON));
            stubAnalyze.onFirstCall().resolves({
                issues: [],
                status: { status: 'Error' },
            });
            stubAnalyze.onSecondCall().resolves({
                issues: [{
                    'sourceFormat': 'evm-byzantium-bytecode',
                    'sourceList': [
                        `${__dirname}/sample-truffle/simple_dao/contracts/simple_dao.sol`
                    ],
                    'sourceType': 'raw-bytecode',
                    'issues': [{
                        'description': {
                            'head': 'Head message',
                            'tail': 'Tail message'
                        },
                        'locations': [{
                            'sourceMap': '444:1:0'
                        }],
                        'severity': 'High',
                        'swcID': 'SWC-000',
                        'swcTitle': 'Test Title'
                    }],
                    'meta': {
                        'selected_compiler': '0.5.0',
                        'error': [],
                        'warning': []
                    },
                }],
                status: {status: 'Pending' },
            });
            const results = await doAnalysis(armletClient, config, jsonFiles);
            mythXInput.analysisMode = 'quick';
            assert.ok(stubAnalyze.calledWith({
                data: mythXInput,
                timeout: 120000,
                clientToolName: 'truffle',
            }));
            assert.equal(results.errors.length, 1);
            assert.equal(results.objects.length, 1);
        });

        it('should skip unwanted smart contract', async () => {
            const doAnalysis = rewiredHelpers.__get__('doAnalysis');
            const config = {
                _: [],
                debug: true,
                logger: {},
                style: 'test-style',
            }
            const jsonFiles = [
                `${__dirname}/sample-truffle/simple_dao/build/contracts/SimpleDAO.json`,
            ];

            const results = await doAnalysis(armletClient, config, jsonFiles, ['UnkonwnContract']);
            assert.ok(!stubAnalyze.called);
            assert.equal(results.errors.length, 0);
            assert.equal(results.objects.length, 0);
        });
    });

    describe('cleanAnalyDataEmptyProps', () => {
        const contractJSON = `${__dirname}/sample-truffle/simple_dao/build/contracts/SimpleDAO.json`;
        let truffleJSON;

        beforeEach(done => {
            fs.readFile(contractJSON, 'utf8', (err, data) => {
                if (err) return done(err);
                truffleJSON = JSON.parse(data);
                done();
            });
        });

        it('should return complete input data when all fields are present', () => {
            const stub = sinon.stub();
            const result = rewiredHelpers.cleanAnalyDataEmptyProps(truffleJSON, true, stub);
            assert.ok(!stub.called);
            assert.deepEqual(result, truffleJSON);
        });

        it('should omit bytecode when bytecode is empty', () => {
            const stub = sinon.stub();
            truffleJSON.bytecode = '';
            const result = rewiredHelpers.cleanAnalyDataEmptyProps(truffleJSON, true, stub);
            assert.ok(stub.called);
            delete truffleJSON.bytecode;
            assert.deepEqual(result, truffleJSON);
        });

        it('should omit bytecode when bytecode is 0x', () => {
            const stub = sinon.stub();
            truffleJSON.bytecode = '0x';
            const result = rewiredHelpers.cleanAnalyDataEmptyProps(truffleJSON, true, stub);
            assert.ok(stub.called);
            delete truffleJSON.bytecode;
            assert.deepEqual(result, truffleJSON);
        });

        it('should omit deployedBytecode when deployedBytecode is empty', () => {
            const stub = sinon.stub();
            truffleJSON.deployedBytecode = '';
            const result = rewiredHelpers.cleanAnalyDataEmptyProps(truffleJSON, true, stub);
            assert.ok(stub.called);
            delete truffleJSON.deployedBytecode;
            assert.deepEqual(result, truffleJSON);
        });

        it('should omit deployedBytecode when deployedBytecode is 0x', () => {
            const stub = sinon.stub();
            truffleJSON.deployedBytecode = '0x';
            const result = rewiredHelpers.cleanAnalyDataEmptyProps(truffleJSON, true, stub);
            assert.ok(stub.called);
            delete truffleJSON.deployedBytecode;
            assert.deepEqual(result, truffleJSON);
        });

        it('should omit sourceMap when sourceMap is empty', () => {
            const stub = sinon.stub();
            truffleJSON.sourceMap = '';
            const result = rewiredHelpers.cleanAnalyDataEmptyProps(truffleJSON, true, stub);
            assert.ok(stub.called);
            delete truffleJSON.sourceMap;
            assert.deepEqual(result, truffleJSON);
        });

        it('should omit deployedSourceMap when deployedSourceMap is empty', () => {
            const stub = sinon.stub();
            truffleJSON.deployedSourceMap = '';
            const result = rewiredHelpers.cleanAnalyDataEmptyProps(truffleJSON, true, stub);
            assert.ok(stub.called);
            delete truffleJSON.deployedSourceMap;
            assert.deepEqual(result, truffleJSON);
        });

        it('should omit empty fields but not log  when debug is false', () => {
            const stub = sinon.stub();
            truffleJSON.deployedSourceMap = '';
            truffleJSON.sourceMap = null;
            truffleJSON.bytecode = '0x';
            delete truffleJSON.deployedBytecode;
            const result = rewiredHelpers.cleanAnalyDataEmptyProps(truffleJSON, false, stub);
            delete truffleJSON.sourceMap;
            delete truffleJSON.deployedSourceMap;
            delete truffleJSON.bytecode;
            delete truffleJSON.deployedBytecode;
            assert.ok(!stub.called);
            assert.deepEqual(result, truffleJSON);
        });
    });

    describe('getNotFoundContracts', () => {
        it('should collect contract names which are not found in truffle build contracts directory', () => {
            const objects = [
                { contractName: 'Contract1' },
                { contractName: 'Contract2' },
            ];

            const result = rewiredHelpers.getNotFoundContracts(objects, ['Contract2', 'NotFoundContract']);
            assert.deepEqual(result, ['NotFoundContract']);
        });

        it('should return empty array when contracts parameter is not passed', () => {
            const objects = [
                { contractName: 'Contract1' },
                { contractName: 'Contract2' },
            ];

            const result = rewiredHelpers.getNotFoundContracts(objects, null);
            assert.deepEqual(result, []);
        });

        it('should return empty array when contracts parameter is empty array', () => {
            const objects = [
                { contractName: 'Contract1' },
                { contractName: 'Contract2' },
            ];

            const result = rewiredHelpers.getNotFoundContracts(objects, []);
            assert.deepEqual(result, []);
        });
    });
});
