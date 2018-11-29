const cliUtils = require('../helpers/cliUtils')

const getAddress = require('../../helpers/getAddress')
const getDxTradeService = require('../../services/DxTradeService')

function registerCommand ({ cli, logger }) {
  cli.command('claim-tokens <token-pairs> [count]', 'Claim tokens for N auctions of a token pair (i.e. claim-tokens WETH-RDN)', yargs => {
    cliUtils.addPositionalByName('token-pairs', yargs)
    cliUtils.addPositionalByName('count', yargs)
  }, async function (argv) {
    const { tokenPairs: tokenPairString, count } = argv
    const tokenPairs = cliUtils.toTokenPairs(tokenPairString)

    const DEFAULT_ACCOUNT_INDEX = 0
    const [
      botAccount,
      dxTradeService
    ] = await Promise.all([
      getAddress(DEFAULT_ACCOUNT_INDEX),
      getDxTradeService()
    ])

    logger.info('Claiming last %d auctions for %s:',
      count, botAccount)
    const [ sellerClaimResult, buyerClaimResult ] = await dxTradeService.claimAll({
      tokenPairs, address: botAccount, lastNAuctions: count
    })
    sellerClaimResult.tx
      ? logger.info('The seller claim was succesful. Transaction: %s', sellerClaimResult.tx)
      : logger.info('No tokens to claim as seller for %s', tokenPairString)
    buyerClaimResult.tx
      ? logger.info('The buyer claim was succesful. Transaction: %s', buyerClaimResult.tx)
      : logger.info('No tokens to claim as buyer for %s', tokenPairString)
  })
}

module.exports = registerCommand
