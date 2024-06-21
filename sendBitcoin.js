const bitcoin = require("bitcoinjs-lib");
const { ECPairFactory } = require("ecpair");
const ecc = require("tiny-secp256k1");
bitcoin.initEccLib(ecc)
const ECPair = ECPairFactory(ecc)


// configuration for mainnet
// const network = bitcoin.networks.bitcoin
// const MEMPOOL_URL = `https://mempool.space`

// configuration for testnet
const network = bitcoin.networks.testnet
const MEMPOOL_URL = `https://mempool.space/testnet`

const DUST_LIMIT = 546
const BASE_TX_SIZE = 10

const BitcoinAddressType = {
  Legacy: 'legacy',
  NestedSegwit: 'nested-segwit',
  NativeSegwit: 'native-segwit',
  Taproot: 'taproot',
  Invalid: 'invalid'
}

const LEGACY_TX_INPUT_SIZE = 148
const LEGACY_TX_OUTPUT_SIZE = 34
const NESTED_SEGWIT_TX_INPUT_SIZE = 91
const NESTED_SEGWIT_TX_OUTPUT_SIZE = 31
const NATIVE_SEGWIT_TX_INPUT_SIZE = 68
const NATIVE_SEGWIT_TX_OUTPUT_SIZE = 31
const TAPROOT_TX_INPUT_SIZE = 58
const TAPROOT_TX_OUTPUT_SIZE = 43

// Function to fetch unspent transaction outputs (UTXOs) for the fromAddress
async function getUTXOs(address) {
  const url = `${MEMPOOL_URL}/api/address/${address}/utxo`
  const response = await fetch(url)
  if (response.ok) {
    const utxo_array = await response.json()
    let confirmed = [], unconfirmed = []
    for (const i in utxo_array)
      utxo_array[i]['status']['confirmed'] ? confirmed.push(utxo_array[i]) : unconfirmed.push(utxo_array[i])
    return {
      success: true,
      confirmed: utxo_array.filter((elem) => elem?.status?.confirmed) || [],
      unconfirmed: utxo_array.filter((elem) => !elem?.status?.confirmed) || []
    }
  }
  else {
    return {
      success: false,
      confirmed: [],
      unconfirmed: []
    }
  }
}

// Function to get confirmed total balance of a bitcoin address
async function getConfirmedBalanceFromAddress(address) {
  const { confirmed } = await getUTXOs(address)
  let totalBalance = 0
  for (const i in confirmed)
    totalBalance += parseInt(confirmed[i]['value'])
  return totalBalance
}

// Function to get current mempool status
async function getSatsbyte() {
  const url = `${MEMPOOL_URL}/api/v1/fees/recommended`
  const response = await fetch(url)
  if (response.ok) {
    const recommendedFees = await response.json()
    return {
      success: true,
      recommendedFees
    }
  }
  else {
    return {
      success: false,
      recommendedFees: {}
    }
  }
}

// Function to determine what type of address it is among 4 bitcoin address types
function getBitcoinAddressType(address) {
  // Regular expressions for different Bitcoin address types
  const legacyRegex = network === bitcoin.networks.bitcoin ? /^[1][a-km-zA-HJ-NP-Z1-9]{25,34}$/ : /^[m,n][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const nestedSegwitRegex = network === bitcoin.networks.bitcoin ? /^[3][a-km-zA-HJ-NP-Z1-9]{25,34}$/ : /^[2][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const nativeSegwitRegex = network === bitcoin.networks.bitcoin ? /^(bc1q)[0-9a-z]{35,59}$/ : /^(tb1q)[0-9a-z]{35,59}$/;
  const taprootRegex = network === bitcoin.networks.bitcoin ? /^(bc1p)[0-9a-z]{39,59}$/ : /^(tb1p)[0-9a-z]{39,59}$/;

  if (legacyRegex.test(address)) {
    return BitcoinAddressType.Legacy;
  } else if (nestedSegwitRegex.test(address)) {
    return BitcoinAddressType.NestedSegwit;
  } else if (nativeSegwitRegex.test(address)) {
    return BitcoinAddressType.NativeSegwit;
  } else if (taprootRegex.test(address)) {
    return BitcoinAddressType.Taproot;
  } else {
    return BitcoinAddressType.Invalid;
  }
}

function getAddressFromWIFandType(wif, type) {
  const keyPair = ECPair.fromWIF(wif);

  if (type === BitcoinAddressType.Legacy)
    return bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address
  else if (type === BitcoinAddressType.NestedSegwit)
    return bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }),
      network
    }).address;
  else if (type === BitcoinAddressType.NativeSegwit)
    return bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address
  else if (type === BitcoinAddressType.Taproot)
    return bitcoin.payments.p2tr({
      internalPubkey: toXOnly(keyPair.publicKey),
      network
    }).address;
  else
    return "invalid"
}

function toXOnly (publicKey) {
  return publicKey.slice(1, 33);
}

function getKeypairInfo (childNode) {
  const childNodeXOnlyPubkey = toXOnly(childNode.publicKey);

  const { address, output } = bitcoin.payments.p2tr({
    internalPubkey: childNodeXOnlyPubkey,
    network
  });

  const tweakedChildNode = childNode.tweak(
    bitcoin.crypto.taggedHash('TapTweak', childNodeXOnlyPubkey),
  );

  return {
    address,
    tweakedChildNode,
    childNodeXOnlyPubkey,
    output,
    childNode
  }
}

// Function to estimate transaction size from input utxos and output utxos and the address type
function estimateTransactionSize(numInputs, numOutputs, type) {
  let inputSize, outputSize

  switch (type) {
    case BitcoinAddressType.Legacy:
      inputSize = LEGACY_TX_INPUT_SIZE;
      outputSize = LEGACY_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.NestedSegwit:
      inputSize = NESTED_SEGWIT_TX_INPUT_SIZE;
      outputSize = NESTED_SEGWIT_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.NativeSegwit:
      inputSize = NATIVE_SEGWIT_TX_INPUT_SIZE;
      outputSize = NATIVE_SEGWIT_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.Taproot:
      inputSize = TAPROOT_TX_INPUT_SIZE;
      outputSize = TAPROOT_TX_OUTPUT_SIZE;
      break;
    default:
      throw new Error('Unknown transaction type');
  }

  return BASE_TX_SIZE + (numInputs * inputSize) + (numOutputs * outputSize);
}

function estimateTransactionFee(numInputs, numOutputs, type, feeRate) {
  const txSize = estimateTransactionSize(numInputs, numOutputs, type);
  return txSize * feeRate;
}

async function getTransactionDetailFromTxID(txid) {
  const url = `${MEMPOOL_URL}/api/tx/${txid}/hex`
  const response = await fetch(url)
  if (response.ok) {
    const hex = await response.text()
    const txDetail = bitcoin.Transaction.fromHex(hex)
    return {
      hex,
      txDetail
    }
  }
  return {
    hex: "",
    txDetail: {}
  }
}

// drains the whole balance from various addresses and gather them to 1 address...
async function transferBtc(fromAddressPairs, toAddress, satsbyte) {

  if (!fromAddressPairs || fromAddressPairs.length === 0)
    return {
      success: false,
      result: "invalid address-key pairs"
    }
  
  const toAddressType = getBitcoinAddressType(toAddress)
  if (toAddressType === BitcoinAddressType.Invalid)
    return {
      success: false,
      result: "invalid toAddress"
    }
  
  // first, validate pairs...
  for (const i in fromAddressPairs) {
    const { address: fromAddress, wif: fromWIF } = fromAddressPairs[i]
    const fromAddressType = getBitcoinAddressType(fromAddress)
    if (fromAddressType === BitcoinAddressType.Invalid)
      return {
        success: false,
        result: `invalid bitcoin address at input #${i}`
      }
      
    // check if fromWIF matches the fromAddress
    const checkingFromAddress = getAddressFromWIFandType(fromWIF, fromAddressType);
    if (fromAddress !== checkingFromAddress)
      return {
        success: false,
        result: `address does not match with wif at input #${i}`
      }    
  }

  // prepares for a map of information showing which key we should use to sign input i
  const inputKeyMap = {}
  const psbt = new bitcoin.Psbt({ network });
  let inputUtxoCount = 0, totalInputSats = 0
  let estimatedInputSize = 0

  for (const i in fromAddressPairs) {
    const { address: fromAddress, wif: fromWIF } = fromAddressPairs[i]
    const fromAddressType = getBitcoinAddressType(fromAddress)
    const keyPair = ECPair.fromWIF(fromWIF);
    const keyPairInfo = getKeypairInfo(keyPair)
    const { confirmed } = await getUTXOs(fromAddress)

    for (const j in confirmed) {
      const { txid, vout, value } = confirmed[j]
      // TODO] better to store transaction hex on the database so that you can reduce unnecessary API calls...
      const { hex, txDetail } = await getTransactionDetailFromTxID(txid)
      if (!hex) {
        return {
          success: false,
          result: `cannot find proper hex for transaction ${txid}`
        }
      }
      const input = {
        hash: txid,
        index: vout
      }
  
      if (fromAddressType === BitcoinAddressType.Legacy) {
        input.nonWitnessUtxo = Buffer.from(hex, 'hex');
        estimatedInputSize += LEGACY_TX_INPUT_SIZE
      }
      if (fromAddressType === BitcoinAddressType.NestedSegwit) {
        input.witnessUtxo = {
          script: txDetail.outs[vout].script,
          value: txDetail.outs[vout].value,
        }
        const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
        input.redeemScript = p2wpkh.output
        estimatedInputSize += NESTED_SEGWIT_TX_INPUT_SIZE
      }
      if (fromAddressType === BitcoinAddressType.NativeSegwit) {
        input.witnessUtxo = {
          script: txDetail.outs[vout].script,
          value: txDetail.outs[vout].value,
        };
        estimatedInputSize += NATIVE_SEGWIT_TX_INPUT_SIZE
      }
      if (fromAddressType === BitcoinAddressType.Taproot) {
        input.witnessUtxo = {
          script: txDetail.outs[vout].script,
          value: txDetail.outs[vout].value,
        };
        input.tapInternalKey = keyPairInfo.childNodeXOnlyPubkey
        estimatedInputSize += TAPROOT_TX_INPUT_SIZE
      }
  
      psbt.addInput(input)

      if (fromAddressType === BitcoinAddressType.Taproot)
        inputKeyMap[`key_${inputUtxoCount}`] = keyPairInfo.tweakedChildNode
      else
        inputKeyMap[`key_${inputUtxoCount}`] = keyPairInfo.childNode

      inputUtxoCount ++
      totalInputSats += value
    }
  }

  let outputSize = 0
  switch(toAddressType) {
    case BitcoinAddressType.Legacy:
      outputSize += LEGACY_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.NestedSegwit:
      outputSize += NESTED_SEGWIT_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.NativeSegwit:
      outputSize += NATIVE_SEGWIT_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.Taproot:
      outputSize += TAPROOT_TX_OUTPUT_SIZE;
  }

  const estimatedTransactionSize = BASE_TX_SIZE + estimatedInputSize + outputSize
  const estimatedTransactionFee = estimatedTransactionSize * satsbyte
  const realOutputValue = totalInputSats - estimatedTransactionFee
  if (realOutputValue <= DUST_LIMIT) {
    return {
      success: false,
      result: "not enough input utxos"
    }
  }

  psbt.addOutput({
    address: toAddress, 
    value: realOutputValue
  })

  for (let i = 0; i < inputUtxoCount; i ++) {
    const signChildNode = inputKeyMap[`key_${i}`]
    console.log(signChildNode)
    psbt.signInput(i, signChildNode)
  }

  psbt.finalizeAllInputs()

  const tx = psbt.extractTransaction()
  const txHex = tx.toHex();
  console.log(`raw transaction hex: ${txHex}`)

  console.log(`sending ${totalInputSats} sats to ${toAddress} at ${satsbyte} satsbyte... arrival: ${realOutputValue}`)

  // broadcast the transaction
  const broadcastAPI = `${MEMPOOL_URL}/api/tx`
  const response = await fetch(broadcastAPI, {
    method: "POST",
    body: txHex,
  })

  if (response.ok) {
    const transactionId = await response.text()
    return {
      success: true,
      result: transactionId
    }
  }

  return {
    success: false,
    result: 'error while broadcast...'
  }
}

// Function to send bitcoin from one address to another
// returns the txid when success, error msg when error
async function sendBtc(fromAddressPair, toAddress, amountInSats) {

  // validate address types
  const { address: fromAddress, wif: fromWIF } = fromAddressPair
  const fromAddressType = getBitcoinAddressType(fromAddress)
  if (fromAddressType === BitcoinAddressType.Invalid)
    return {
      success: false,
      result: "invalid fromAddress"
    }

  const toAddressType = getBitcoinAddressType(toAddress)
  if (toAddressType === BitcoinAddressType.Invalid)
    return {
      success: false,
      result: "invalid toAddress"
    }

  // first check if that address holds such balance
  const currentBalance = await getConfirmedBalanceFromAddress(fromAddress)
  if (amountInSats >= currentBalance)
    return {
      success: false,
      result: "insufficient confirmed balance"
    }

  // check if fromWIF matches the fromAddress
  const checkingFromAddress = getAddressFromWIFandType(fromWIF, fromAddressType);
  if (fromAddress !== checkingFromAddress)
    return {
      success: false,
      result: "fromAddress does not match with fromWIF"
    }

  // now building transactions based on address types
  const keyPair = ECPair.fromWIF(fromAddressPair.wif);
  const keyPairInfo = getKeypairInfo(keyPair)
  const { confirmed } = await getUTXOs(fromAddress)
  const sortedUTXOs = confirmed.sort((a, b) => parseInt(a.value) - parseInt(b.value))

  // get current mempool state
  const { success, recommendedFees } = await getSatsbyte()
  if (!success)
    return {
      success: false,
      result: "Error while getting mempool state"
    }

  // we are firing transaction at fastestFee because users want immediate withdrawal...
  const { fastestFee } = recommendedFees

  // build transaction
  const psbt = new bitcoin.Psbt({ network });
  let totalInputSats = 0, inputUtxoCount = 0
  let estimatedTransactionFee = estimateTransactionFee(1, 1, toAddressType, fastestFee)
  let inputsAreEnough = false
  for (const i in sortedUTXOs) {
    const { txid, vout, value } = sortedUTXOs[i]
    // TODO] better to store transaction hex on the database so that you can reduce unnecessary API calls...
    const { hex, txDetail } = await getTransactionDetailFromTxID(txid)
    if (!hex) {
      return {
        success: false,
        result: `cannot find proper hex for transaction ${txid}`
      }
    }
    const input = {
      hash: txid,
      index: vout
    }

    if (fromAddressType === BitcoinAddressType.Legacy)
      input.nonWitnessUtxo = Buffer.from(hex, 'hex');
    if (fromAddressType === BitcoinAddressType.NestedSegwit) {
      input.witnessUtxo = {
        script: txDetail.outs[vout].script,
        value: txDetail.outs[vout].value,
      }
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
      input.redeemScript = p2wpkh.output
    }
    if (fromAddressType === BitcoinAddressType.NativeSegwit)
      input.witnessUtxo = {
        script: txDetail.outs[vout].script,
        value: txDetail.outs[vout].value,
      };
    if (fromAddressType === BitcoinAddressType.Taproot) {
      input.witnessUtxo = {
        script: txDetail.outs[vout].script,
        value: txDetail.outs[vout].value,
      };
      input.tapInternalKey = keyPairInfo.childNodeXOnlyPubkey
    }

    psbt.addInput(input)
    inputUtxoCount ++
    totalInputSats += value
    estimatedTransactionFee = estimateTransactionFee(inputUtxoCount, 2, toAddressType, fastestFee)
    if (totalInputSats >= amountInSats + estimatedTransactionFee) {
      inputsAreEnough = true
      psbt.addOutput({
        address: toAddress, 
        value: amountInSats
      })
      if (totalInputSats - amountInSats - estimatedTransactionFee > DUST_LIMIT) 
        psbt.addOutput({
          address: fromAddress, 
          value: totalInputSats - amountInSats - estimatedTransactionFee
        })
    }
  }

  if (!inputsAreEnough) {
    return {
      success: false,
      result: "Input UTXOs are not enough to send..."
    }
  }

  console.log(`sending ${amountInSats} from ${fromAddress} to ${toAddress}`)
  console.log(`estimatedFee: ${estimatedTransactionFee}`)
  console.log(`firing tx at ${fastestFee} satsbyte`)

  if (fromAddressType === BitcoinAddressType.Taproot) {
    for (let i = 0; i < inputUtxoCount; i ++)
      psbt.signInput(i, keyPairInfo.tweakedChildNode)
  }
  else {
    for (let i = 0; i < inputUtxoCount; i ++)
      psbt.signInput(i, keyPairInfo.childNode)
  }

  psbt.finalizeAllInputs()

  const tx = psbt.extractTransaction()
  const txHex = tx.toHex();
  console.log(`raw transaction hex: ${txHex}`)

  // broadcast the transaction
  const broadcastAPI = `${MEMPOOL_URL}/api/tx`
  const response = await fetch(broadcastAPI, {
    method: "POST",
    body: txHex,
  })

  if (response.ok) {
    const transactionId = await response.text()
    return {
      success: true,
      result: transactionId
    }
  }

  return {
    success: false,
    result: 'error while broadcast...'
  }
}

module.exports = {
  BitcoinAddressType,
  getUTXOs,
  getBitcoinAddressType,
  getConfirmedBalanceFromAddress,
  getSatsbyte,
  transferBtc,
  sendBtc,
};
