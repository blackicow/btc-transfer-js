const { getUTXOs, getSatsbyte, getConfirmedBalanceFromAddress, sendBtc, transferBtc } = require('./sendBitcoin')

const test_getUTXOs = async () => {
  const { success, confirmed, unconfirmed } = await getUTXOs('some-address')
  console.log(success)
  console.log(confirmed.length)
  console.log(unconfirmed.length)
}

const test_getSatsbyte = async () => {
  const { success, recommendedFees } = await getSatsbyte()
  console.log(success)
  console.log(recommendedFees)
}

const test_getConfirmedBalanceFromAddress = async () => {
  const balance = await getConfirmedBalanceFromAddress('some-address')
  console.log(balance)
}

const test_sendBtc = async () => {
  const wif = 'sender-wif'
  const fromAddress = 'sender-address'
  const toAddress = 'receiver-address'
  const amountInSats = 100000
  const result = await sendBtc({
    wif,
    address: fromAddress
  }, toAddress, amountInSats)
  console.log(result)
}

const test_transferBtc = async () => {
  const array = [
    {
      address: "user-deposit-address",
      wif: "that-wif"
    },
    {
      address: "user-deposit-address",
      wif: "that-wif"
    },
    {
      address: "user-deposit-address",
      wif: "that-wif"
    },
    {
      address: "user-deposit-address",
      wif: "that-wif"
    },
  ]
  const toAddress = "treasure-address"

  const result = await transferBtc(array, toAddress, 300)
  console.log(result)
}

// test_getUTXOs()
// test_getSatsbyte()
// test_getConfirmedBalanceFromAddress()
// test_sendBtc()
// test_transferBtc()