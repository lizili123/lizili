const _ = require('lodash');
const Utils = require('./../../../utils');
const md5 = require('md5');

const {
  deFormatPair,
  formatWsResult,
  parseOrderType,
  createWsChanel,
  formatPair,
  _parse,
  formatInterval,
  extactPairFromSpotChannel,
} = require('./public');

function formatTick(d, pair) {
  if (!d) {
    console.log('okex tick数据为空...');
    return null;
  }
  const { date, ticker } = d;
  const time = new Date(date * 1000);
  return {
    pair,
    time,
    last_price: _parse(ticker.last),
    ask_price: _parse(ticker.buy),
    bid_price: _parse(ticker.sell),
    volume_24: _parse(ticker.vol)
  };
}

// kline
function formatKlineO(o) {
  o = _.cloneDeep(o);
  o.type = formatInterval(o.interval);
  delete o.interval;
  return o;
}
function formatKline(ds, o) {
  return _.map(ds, (d) => {
    const time = new Date(d[0]);
    const tstr = time.getTime();
    return {
      unique_id: md5(`${o.pair}_${tstr}_${o.interval}`),
      ...o,
      time,
      open: _parse(d[1]),
      high: _parse(d[2]),
      low: _parse(d[3]),
      close: _parse(d[4]),
    };
  });
}

// depth
function _formatDepth(ds) {
  return _.map(ds, (d) => {
    return {
      priceStr: d[0],
      price: _parse(d[0]),
      volumeStr: _parse(d[1]),
      volume: _parse(d[1])
    };
  });
}

function formatDepth(ds) {
  return {
    time: new Date(ds.lastUpdateId * 1000),
    bids: _formatDepth(ds.biz),
    asks: _formatDepth(ds.asks),
  };
}

function formatOrderBook(ds) {
  return _.map(ds, (d) => {
    return {
      time: new Date(d.date_ms),
      price: d.price,
      volume: d.amount,
      side: d.type.toUpperCase(),
      order_id: d.tid,
    };
  });
}

function formatBalances(ds) {
  const funds = _.get(ds, 'info.funds');
  if (!funds) return null;
  const { free, freezed, borrow } = funds;
  const result = {};
  _.forEach(free, (str, coin) => {
    _.set(result, `${coin}.balance_str`, str);
    _.set(result, `${coin}.balance`, _parse(str));
  });
  _.forEach(borrow, (str, coin) => {
    _.set(result, `${coin}.borrow_balance_str`, str);
    _.set(result, `${coin}.borrow_balance`, _parse(str));
  });
  _.forEach(freezed, (str, coin) => {
    _.set(result, `${coin}.locked_balance_str`, str);
    _.set(result, `${coin}.locked_balance`, _parse(str));
    //
    _.set(result, `${coin}.coin`, coin.toUpperCase());
  });
  return _.values(result).filter((d) => {
    return d.balance !== 0 || d.locked_balance !== 0 || d.borrow_balance !== 0;
  });
}

function formatOrderO(o) {
  const { type = 'LIMIT', side, price, pair, amount } = o;
  let okexType = side.toLowerCase();
  if (type && type.toLowerCase() === 'market') okexType += '_market';
  const extra = (price && type !== 'MARKET') ? { price } : {};
  return {
    symbol: formatPair(pair),
    type: okexType,
    amount,
    ...extra
  };
}

function formatCancelOrderO(o = {}) {
  let { order_id } = o;
  if (Array.isArray(order_id)) order_id = order_id.join(',');
  const symbol = formatPair(o.pair);
  return { order_id, symbol };
}

function formatOrderResult(ds) {
  if (ds.order_id) return { order_id: ds.order_id };
  throw ds;
}
//
const code2Status = {
  '-1': 'CANCEL',
  0: 'UNFINISH',
  1: 'PARTIAL',
  2: 'SUCCESS',
  3: 'CANCELLING'
};
const status2Code = _.invert(code2Status);

function formatOrderInfo(ds, o) {
  if (!ds) return null;
  const { orders } = ds;
  if (!orders) return null;
  let res = _.map(orders, (d) => {
    const { type: tp } = d;
    let [side, type] = tp.split('_').map(d => d.toUpperCase());
    type = type || 'LIMIT';
    return {
      order_id: `${d.orders_id}`,
      order_main_id: `${d.order_id}`,
      amount: d.deal_amount,
      price: d.avg_price,
      status: code2Status[d.status],
      side,
      type,
      time: new Date(d.create_date),
      pair: o.pair
    };
  });
  if (Array.isArray(res) && res.length === 1) res = res[0];
  return res;
}

function formatAllOrdersO(o) {
  o = _.cloneDeep(o);
  o.status = status2Code[o.status];
  return o;
}
function formatAllOrders(ds) {
  if (!ds) return null;
  return _.map(ds.orders, (d) => {
    return {
      amount: d.amount,
      price: d.price || null,
      time: new Date(d.create_date),
      deal_amount: d.deal_amount,
      order_main_id: d.order_id,
      order_id: d.orders_id,
      status: code2Status[d.status],
      pair: deFormatPair(d.symbol),
      ...parseOrderType(d.type)
    };
  });
}

const createSpotChanelBalance = createWsChanel((pair) => {
  const symbol = formatPair(pair, false);
  return `ok_sub_spot_${symbol}_balance`;
});

const createSpotChanelTick = createWsChanel((pair) => {
  const symbol = formatPair(pair, false);
  return `ok_sub_spot_${symbol}_ticker`;
});

function formatWsBalance(ds) {
  console.log('formatWsBalance 还有问题');
  process.exit();
  ds = _.map(ds, (d) => {
    const { data, channel } = d;
    const pair = extactPairFromSpotChannel(channel, '_balance');
    if (!data) return;
    const { info } = data;
    if (!info) return;
    const { free: balance, freezed: balanceLocked } = info;
    return { pair, balance, balanceLocked };
  }).filter(d => d);
  return _.keyBy(ds, 'coin');
}

function formatWsTick(ds) {
  ds = _.map(ds, (d) => {
    const { data, channel } = d;
    const bid_price = parseFloat(data.buy, 10);
    const ask_price = parseFloat(data.sell, 10);
    const volume_24 = parseFloat(data.vol, 10);
    const change = parseFloat(data.change, 10);
    const last_price = parseFloat(data.last, 10);
    if (!bid_price || !ask_price) return null;
    return {
      pair: extactPairFromSpotChannel(channel, '_ticker'),
      bid_price,
      ask_price,
      last_price,
      volume_24,
      change,
      time: new Date()
    };
  }).filter(d => d);
  return _.keyBy(ds, 'pair');
}
module.exports = {
  formatPair,
  formatTick,
  formatDepth,
  formatOrderBook,
  formatBalances,
  formatOrderO,
  formatCancelOrderO,
  formatOrderResult,
  formatKline,
  formatKlineO,
  formatOrderInfo,
  formatAllOrdersO,
  formatAllOrders,
  // ws
  createSpotChanelBalance,
  createSpotChanelTick,
  formatWsBalance,
  formatWsTick,
};
