const loggerNamespace = 'dx-service:services:DxInfoService'
// const Logger = require('../helpers/Logger')
// const logger = new Logger(loggerNamespace)
const AuctionLogger = require('../helpers/AuctionLogger')
const auctionLogger = new AuctionLogger(loggerNamespace)
const ENVIRONMENT = process.env.NODE_ENV

const numberUtil = require('../helpers/numberUtil.js')

const getGitInfo = require('../helpers/getGitInfo')
const getVersion = require('../helpers/getVersion')
const getAuctionsBalances = require('./helpers/getAuctionsBalances')
const getClaimableTokens = require('./helpers/getClaimableTokens')

class DxInfoService {
  constructor ({ auctionRepo, ethereumRepo, config }) {
    this._auctionRepo = auctionRepo
    this._ethereumRepo = ethereumRepo
    this._markets = config.MARKETS

    // About info
    this._gitInfo = getGitInfo()
    this._version = getVersion()
  }

  async getVersion () {
    return this._version
  }

  async getHealthEthereum () {
    return this._ethereumRepo.getHealth()
  }

  async getAuctionIndex ({ sellToken, buyToken }) {
    return this._auctionRepo.getAuctionIndex({ sellToken, buyToken })
  }

  async getClosingPrice ({ sellToken, buyToken, auctionIndex }) {
    let closingPrice = await this._auctionRepo.getClosingPrices({
      sellToken,
      buyToken,
      auctionIndex
    })
    if (closingPrice) {
      closingPrice = this._computePrice(closingPrice)
    }
    return closingPrice
  }

  _computePrice ({ numerator, denominator }) {
    return numerator.div(denominator)
  }

  async getLastClosingPrices ({ sellToken, buyToken, count }) {
    // Get data
    const auctionIndex = await this._auctionRepo.getAuctionIndex({ sellToken, buyToken })
    const closingPricesPromises = []
    const startAuctionIndex = (auctionIndex - count) > 0 ? auctionIndex - count + 1 : 0
    for (var i = startAuctionIndex; i <= auctionIndex; i++) {
      const auctionIndexAux = i
      const closingPricePromise = this._auctionRepo.getClosingPrices({
        sellToken,
        buyToken,
        auctionIndex: auctionIndexAux
      })
        .then(price => ({
          price,
          auctionIndex: auctionIndexAux
        }))

      closingPricesPromises.push(closingPricePromise)
    }

    const closingPrices = await Promise.all(closingPricesPromises)
    return closingPrices
      .map((closingPrice, i) => {
        let percentage
        if (i > 0) {
          let previousClosingPrice = numberUtil
            .toBigNumberFraction(closingPrices[i - 1].price, true)
          let currentClosingPrice = numberUtil
            .toBigNumberFraction(closingPrice.price, true)

          if (currentClosingPrice &&
            !currentClosingPrice.isZero() &&
            !previousClosingPrice.isZero()
          ) {
            percentage = currentClosingPrice
              .minus(previousClosingPrice)
              .div(previousClosingPrice)
              .mul(100)
          }
        }

        return {
          auctionIndex: closingPrice.auctionIndex,
          price: closingPrice.price,
          percentage
        }
      })
      .reverse()
  }

  async getLastClosingPricesComputed ({ sellToken, buyToken, count }) {
    let closingPrices = await this.getLastClosingPrices({ sellToken, buyToken, count })
    if (closingPrices.length > 0) {
      return closingPrices.map(element => {
        if (element.price) {
          return Object.assign(element,
            { price: this._computePrice(element.price) }
          )
        } else {
          return element
        }
      })
    } else {
      return []
    }
  }

  // TODO: This method I think is not very useful for us...
  async getSellerBalancesOfCurrentAuctions ({ tokenPairs, address }) {
    return this._auctionRepo.getSellerBalancesOfCurrentAuctions({
      tokenPairs, address
    })
  }

  async getAuctionsBalances ({ tokenA, tokenB, address, count }) {
    return getAuctionsBalances({
      auctionRepo: this._auctionRepo,
      tokenA,
      tokenB,
      address,
      count
    })
  }

  async getClaimableTokens ({ tokenA, tokenB, address, lastNAuctions }) {
    return getClaimableTokens({
      auctionRepo: this._auctionRepo,
      tokenA,
      tokenB,
      address,
      lastNAuctions
    })
  }

  async getMarketDetails ({ sellToken, buyToken }) {
    const tokenPair = { sellToken, buyToken }
    const [
      isSellTokenApproved,
      isBuyTokenApproved,
      stateInfo,
      state,
      isApprovedMarket,
      auctionIndex
    ] = await Promise.all([
      this._auctionRepo.isApprovedToken({ token: sellToken }),
      this._auctionRepo.isApprovedToken({ token: buyToken }),
      this._auctionRepo.getStateInfo(tokenPair),
      this._auctionRepo.getState(tokenPair),
      this._auctionRepo.isApprovedMarket({
        tokenA: sellToken,
        tokenB: buyToken
      }),
      this._auctionRepo.getAuctionIndex(tokenPair)
    ])

    const result = {
      isApprovedMarket,
      state,
      isSellTokenApproved,
      isBuyTokenApproved,
      auctionIndex: stateInfo.auctionIndex,
      auctionStart: stateInfo.auctionStart
    }

    // Get auction details for one of the auctions
    const auctionDetailPromises = []
    if (stateInfo.auction) {
      const getAuctionDetailsPromise = this._getAuctionDetails({
        auction: stateInfo.auction,
        tokenA: sellToken,
        tokenB: buyToken,
        auctionIndex,
        state
      }).then(auctionDetails => {
        result.auction = auctionDetails
      })
      auctionDetailPromises.push(getAuctionDetailsPromise)
    }

    // Get auction details for the other one
    if (stateInfo.auctionOpp) {
      const getAuctionDetailsPromise = this._getAuctionDetails({
        auction: stateInfo.auctionOpp,
        tokenA: buyToken,
        tokenB: sellToken,
        auctionIndex,
        state
      }).then(auctionDetails => {
        result.auctionOpp = auctionDetails
      })
      auctionDetailPromises.push(getAuctionDetailsPromise)
    }

    // If we have pending promises, we wait for them
    if (auctionDetailPromises.length > 0) {
      await Promise.all(auctionDetailPromises)
    }

    return result
  }

  async _getAuctionDetails ({ auction, tokenA, tokenB, auctionIndex, state }) {
    const {
      sellVolume,
      buyVolume,
      isClosed,
      isTheoreticalClosed,
      closingPrice
    } = auction

    const [ fundingInUSD, price, closingPriceSafe ] = await Promise.all([
      // Get the funding of the market
      this._auctionRepo.getFundingInUSD({
        tokenA, tokenB, auctionIndex
      }),
      // Get the actual price
      this._auctionRepo.getCurrentAuctionPrice({
        sellToken: tokenA,
        buyToken: tokenB,
        auctionIndex
      }),
      // Get the last "official" closing price
      this._auctionRepo.getPastAuctionPrice({
        sellToken: tokenA,
        buyToken: tokenB,
        auctionIndex
      })
    ])
    let buyVolumesInSellTokens, priceRelationshipPercentage,
      boughtPercentage, outstandingVolume

    if (price) {
      if (price.numerator.isZero()) {
        // The auction runned for too long
        buyVolumesInSellTokens = sellVolume
      } else {
        // Get the number of sell tokens that we can get for the buyVolume
        buyVolumesInSellTokens = price.denominator
          .times(buyVolume)
          .div(price.numerator)

        // If we have a closing price, we compare the prices
        if (closingPriceSafe) {
          priceRelationshipPercentage = price.numerator
            .mul(closingPriceSafe.denominator)
            .div(price.denominator)
            .div(closingPriceSafe.numerator)
            .mul(100)
        }
      }

      if (!sellVolume.isZero()) {
        // Get the bought percentage:
        //    100 - 100 * (sellVolume - soldTokens) / sellVolume
        boughtPercentage = numberUtil.getPercentage({
          part: buyVolumesInSellTokens,
          total: sellVolume
        })
      }

      if (closingPrice) {
        if (price.numerator.isZero()) {
          // The auction runned for too long
          buyVolumesInSellTokens = sellVolume
          priceRelationshipPercentage = null
        } else {
          // Get the number of sell tokens that we can get for the buyVolume
          buyVolumesInSellTokens = price.denominator
            .times(buyVolume)
            .div(price.numerator)

          priceRelationshipPercentage = price.numerator
            .mul(closingPrice.denominator)
            .div(price.denominator)
            .div(closingPrice.numerator)
            .mul(100)
        }
      }

      if (state.indexOf('WAITING') === -1) {
        // Show outstanding volumen if we are not in a waiting period
        outstandingVolume = await this._auctionRepo.getOutstandingVolume({
          sellToken: tokenA,
          buyToken: tokenB,
          auctionIndex
        })
      }
    }

    return {
      sellVolume,
      buyVolume,
      isClosed,
      isTheoreticalClosed,
      closingPrice: closingPriceSafe, // official closing price (no 0)
      price,
      fundingInUSD: fundingInUSD.fundingA,
      buyVolumesInSellTokens,
      priceRelationshipPercentage,
      boughtPercentage,
      outstandingVolume
    }
  }

  async getAbout () {
    const auctionAbout = await this._auctionRepo.getAbout()
    const ethereumAbout = await this._ethereumRepo.getAbout()

    return {
      version: this._version,
      environment: ENVIRONMENT,
      auctions: auctionAbout,
      ethereum: ethereumAbout,
      git: this._gitInfo
    }
  }

  // TODO implement pagination
  async getMarkets ({ count } = {}) {
    const tokenPairsPromises = this._markets.map(async ({ tokenA, tokenB }) => {
      const [ tokenAAddress, tokenBAddress ] = await Promise.all([
        this._auctionRepo.getTokenAddress({
          token: tokenA
        }),
        this._auctionRepo.getTokenAddress({
          token: tokenB
        })
      ])
      const [ tokenAInfo, tokenBInfo ] = await Promise.all([
        this._getTokenInfoByAddress(tokenAAddress),
        this._getTokenInfoByAddress(tokenBAddress)
      ])
      return {
        tokenA: tokenAInfo, tokenB: tokenBInfo
      }
    })

    const tokenPairs = {
      data: [],
      pagination: {}
    }

    tokenPairs.data = await Promise.all(tokenPairsPromises)
    tokenPairs.pagination = {
      endingBefore: null,
      startingAfter: null,
      limit: count,
      order: [{
        param: 'symbol',
        direction: 'ASC'
      }],
      previousUri: null,
      nextUri: null
    }

    return tokenPairs
  }

  // TODO implement pagination
  async getTokenList ({ count, approved = true } = {}) {
    // TODO implement retrieving data from blockchain
    const tokenList = {
      data: [],
      pagination: {}
    }
    const fundedTokenList = await this.getFundedTokenList()

    tokenList.data = fundedTokenList
    tokenList.pagination = {
      endingBefore: null,
      startingAfter: null,
      limit: count,
      order: [{
        param: 'symbol',
        direction: 'ASC'
      }],
      previousUri: null,
      nextUri: null
    }
    return tokenList
  }

  async getFundedTokenList () {
    let tokenList = this._markets.reduce((list, {tokenA, tokenB}) => {
      if (list.indexOf(tokenA) === -1) {
        list.push(tokenA)
      }

      if (list.indexOf(tokenB) === -1) {
        list.push(tokenB)
      }
      return list
    }, [])

    let addressesList = await Promise.all(
      tokenList.map(token => {
        return this._auctionRepo.getTokenAddress({ token })
      }))

    let detailedTokenList = await Promise.all(addressesList.map(address => {
      return this._getTokenInfoByAddress(address)
    }))

    return detailedTokenList
    // return this._auctionRepo.getTokens()
  }

  async _getTokenInfoByAddress (address) {
    return this._ethereumRepo.tokenGetInfo({ tokenAddress: address })
  }

  // TODO implement
  async getCurrencies () {}

  async getState ({ sellToken, buyToken }) {
    auctionLogger.debug({ sellToken, buyToken, msg: 'Get current state' })

    return this._auctionRepo.getState({ sellToken, buyToken })
  }

  async getCurrentPrice ({ sellToken, buyToken }) {
    auctionLogger.debug({ sellToken, buyToken, msg: 'Get current price' })

    const auctionIndex = await this._auctionRepo.getAuctionIndex({ sellToken, buyToken })
    let currentPrice = await this._auctionRepo.getCurrentAuctionPrice({ sellToken, buyToken, auctionIndex })

    if (currentPrice) {
      currentPrice = this._computePrice(currentPrice)
    }

    return currentPrice
  }

  async getAuctionStart ({ sellToken, buyToken }) {
    auctionLogger.debug({ sellToken, buyToken, msg: 'Get auction start' })

    return this._auctionRepo.getAuctionStart({ sellToken, buyToken })
  }

  async isApprovedMarket ({ sellToken, buyToken }) {
    return this._auctionRepo.isApprovedMarket({
      tokenA: sellToken,
      tokenB: buyToken
    })
  }

  async getSellVolume ({ sellToken, buyToken }) {
    let state = await this._auctionRepo.getStateInfo({ sellToken, buyToken })
    if (state.auction) {
      return state.auction.sellVolume
    } else {
      return null
    }
  }

  async getSellVolumeNext ({ sellToken, buyToken }) {
    let state = await this._auctionRepo.getStateInfo({ sellToken, buyToken })
    if (state.auction) {
      return state.auction.sellVolumeNext
    } else {
      return null
    }
  }

  async getBuyVolume ({ sellToken, buyToken }) {
    let state = await this._auctionRepo.getStateInfo({ sellToken, buyToken })
    if (state.auction) {
      return state.auction.buyVolume
    } else {
      return null
    }
  }

  async getSellerBalanceForCurrentAuction ({ sellToken, buyToken, address }) {
    let auctionIndex = await this._auctionRepo.getAuctionIndex({ sellToken, buyToken })

    return this._auctionRepo.getSellerBalance({ sellToken, buyToken, auctionIndex, address })
  }

  async getBuyerBalanceForCurrentAuction ({ sellToken, buyToken, address }) {
    let auctionIndex = await this._auctionRepo.getAuctionIndex({ sellToken, buyToken })

    return this._auctionRepo.getBuyerBalance({ sellToken, buyToken, auctionIndex, address })
  }

  async getBalances ({ address }) {
    return this._auctionRepo.getBalances({ address })
  }

  async getBalanceOfEther ({ account }) {
    return this._ethereumRepo.balanceOf({ account })
  }

  async getAccountBalanceForToken ({ token, address }) {
    return this._auctionRepo.getBalance({
      token,
      address
    })
  }

  async getPriceInUSD ({ token, amount }) {
    return this._auctionRepo.getPriceInUSD({
      token,
      amount
    })
  }

  async getOperations ({
    fromDate,
    toDate,

    // optional params
    type,
    account,
    token,
    sellToken,
    buyToken,
    auctionIndex
  }) {
    const [ fromBlock, toBlock ] = await Promise.all([
      this._ethereumRepo.getFirstBlockAfterDate(fromDate),
      this._ethereumRepo.getLastBlockBeforeDate(toDate)
    ])

    const getSellOrders = () => {
      return this._auctionRepo.getSellOrders({
        fromBlock,
        toBlock,
        user: account,
        sellToken,
        buyToken,
        auctionIndex
      })
    }
    const getBuyOrders = () => {
      return this._auctionRepo.getBuyOrders({
        fromBlock,
        toBlock,
        user: account,
        sellToken,
        buyToken,
        auctionIndex
      })
    }

    // Decide if we get sellOrders, buyOrders, or both
    let sellOrders, buyOrders
    if (type) {
      switch (type) {
        case 'ask':
          // Get just sell orders
          sellOrders = await getSellOrders()
          buyOrders = []
          break

        case 'bid':
        // Get just buy orders
          sellOrders = []
          buyOrders = await getBuyOrders()
          break
        default:
          throw new Error('Unknown trade type: ' + type)
      }
    } else {
      // Get both: sell and buy orders
      const [ sellOrdersAux, buyOrdersAux ] = await Promise.all([
        getSellOrders(),
        getBuyOrders()
      ])
      sellOrders = sellOrdersAux
      buyOrders = buyOrdersAux
    }

    const orders = sellOrders.concat(buyOrders)
    let ordersDto = await this._toBuyOrderDto(orders)

    if (token) {
      // Filter out the auction that don't have the token
      // TODO: This filter is done programatically for simplicity, but we can
      // check if there is a performance gain when is done as a repo filter,
      // especially if the number of token pairs grows a lot
      ordersDto = ordersDto.filter(order => {
        return order.sellToken.symbol === token ||
          order.buyToken.symbol === token
      })
    }

    return ordersDto
  }

  async _toBuyOrderDto (orders) {
    const orderDtoPromises = orders.map(async order => {
      const {
        sellToken,
        buyToken,
        auctionIndex,
        user,
        amount,
        dateTime,
        ethInfo
      } = order

      const [ sellTokenInfo, buyTokenInfo ] = await Promise.all([
        // Get sell token info
        this._ethereumRepo.tokenGetInfo({
          tokenAddress: sellToken
        }),

        // Get buy token info
        this._ethereumRepo.tokenGetInfo({
          tokenAddress: buyToken
        })
      ])

      let type
      switch (ethInfo.event) {
        case 'NewSellOrder':
          type = 'ask'
          break

        case 'NewBuyOrder':
          type = 'bid'
          break

        default:
          break
      }

      return {
        auctionIndex,
        sellToken: sellTokenInfo,
        buyToken: buyTokenInfo,
        user,
        amount,
        dateTime,
        type
      }
    })

    return Promise.all(orderDtoPromises)
  }

  async getCurrentFeeRatio ({ address }) {
    let feeRatio = await this._auctionRepo.getFeeRatio({ address })

    return feeRatio[0].div(feeRatio[1])
  }

  async getExtraTokens ({ sellToken, buyToken, auctionIndex }) {
    return this._auctionRepo.getExtraTokens({ sellToken, buyToken, auctionIndex })
  }
}

module.exports = DxInfoService
