const BuyLiquidityBot = require('../../src/bots/BuyLiquidityBot')
const EventBus = require('../../src/helpers/EventBus')

const testSetup = require('../helpers/testSetup')
const setupPromise = testSetup()

const BigNumber = require('bignumber.js')

const MARKETS = [
  { tokenA: 'ETH', tokenB: 'RDN' },
  { tokenA: 'ETH', tokenB: 'OMG' }
]

let buyLiquidityBot

beforeEach(async () => {
  const { liquidityService } = await setupPromise

  buyLiquidityBot = new BuyLiquidityBot({
    name: 'BuyLiquidityBot',
    eventBus: new EventBus(),
    liquidityService,
    botAddress: '0x123',
    markets: MARKETS
  })

  jest.useFakeTimers()

  buyLiquidityBot.start()
})

afterEach(() => {
  buyLiquidityBot.stop()
})

test('It should do a routine check.', async () => {
  // we mock ensureBuyLiquidity function
  buyLiquidityBot._liquidityService.ensureBuyLiquidity = jest.fn(_ensureLiquidity)
  const ENSURE_BUY_LIQUIDITY = buyLiquidityBot._liquidityService.ensureBuyLiquidity

  // GIVEN a never called ensureBuyLiquidity function
  expect(ENSURE_BUY_LIQUIDITY).toHaveBeenCalledTimes(0)

  // WHEN we wait for an expected time
  jest.runOnlyPendingTimers()

  // THEN bot autochecked liquidity for all markets just in case
  expect(ENSURE_BUY_LIQUIDITY).toHaveBeenCalledTimes(2)
})

test('It should not buy remaining liquidity if already buying liquidity.', () => {
  expect.assertions(1)
  // we mock ensureBuyLiquidity function
  buyLiquidityBot._liquidityService.ensureBuyLiquidity = _concurrentLiquidityEnsured

  // GIVEN a running bot

  // WHEN we buy remaining liquidity
  const ENSURE_LIQUIDITY = buyLiquidityBot._ensureBuyLiquidity({
    buyToken: 'RDN', sellToken: 'ETH', from: '0x123'})

  // THEN concurrency is detected and do nothing
  ENSURE_LIQUIDITY.then(result => {
    expect(result).toBeTruthy()
  })
})

test('It should buy remaining liquidity.', () => {
  expect.assertions(3)
  // we mock ensureBuyLiquidity function
  buyLiquidityBot._liquidityService.ensureBuyLiquidity = jest.fn(_ensureLiquidity)
  const ENSURE_BUY_LIQUIDITY_FN = buyLiquidityBot._liquidityService.ensureBuyLiquidity

  // GIVEN never ensured liquidity  market
  expect(ENSURE_BUY_LIQUIDITY_FN).toHaveBeenCalledTimes(0)

  // WHEN we buy remaining liquidity
  const ENSURE_LIQUIDITY = buyLiquidityBot._ensureBuyLiquidity({
    buyToken: 'RDN', sellToken: 'ETH', from: '0x123'})

  // THEN liquidiy is ensured correctly
  ENSURE_LIQUIDITY.then(result => {
    expect(result).toBeTruthy()
  })
  expect(ENSURE_BUY_LIQUIDITY_FN).toHaveBeenCalledTimes(1)
})

test('It should handle errors if something goes wrong.', () => {
  expect.assertions(3)
  // we mock ensureBuyLiquidity function
  buyLiquidityBot._liquidityService.ensureBuyLiquidity = jest.fn(_ensureLiquidityError)
  buyLiquidityBot._handleError = jest.fn(buyLiquidityBot._handleError)
  const HANDLE_ERROR_FN = buyLiquidityBot._handleError

  // GIVEN never called handling error function
  expect(HANDLE_ERROR_FN).toHaveBeenCalledTimes(0)

  // WHEN we ensure liquidity but an error is thrown
  const ENSURE_LIQUIDITY = buyLiquidityBot._ensureBuyLiquidity({
    buyToken: 'RDN', sellToken: 'ETH', from: '0x123'})

  // THEN liquidity can't be ensured
  ENSURE_LIQUIDITY.then(result => {
    expect(result).toBeFalsy()
  })
  // THEN handling error function is called
  expect(HANDLE_ERROR_FN).toHaveBeenCalledTimes(1)
})

function _concurrentLiquidityEnsured ({ sellToken, buyToken, from }) {
  return Promise.resolve([])
}

function _ensureLiquidity ({ sellToken, buyToken, from }) {
  return Promise.resolve([{
    sellToken,
    buyToken,
    amount: new BigNumber('522943983903581200'),
    amountInUSD: new BigNumber('523.97')
  }])
}

function _ensureLiquidityError ({ sellToken, buyToken, from }) {
  throw Error('This is an EXPECTED test error')
}
