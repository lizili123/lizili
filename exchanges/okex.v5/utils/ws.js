

const _ = require('lodash');
const _ws = require('./_ws');
const { symbol2pair } = require('./public');
const { checkKey, formatter, getSwapFundingTime } = require('./../../../utils');
const ef = require('./../../../utils/formatter');
const futureUtils = require('./future');
const marginUtils = require('./margin');
const spotUtils = require('./spot');
const swapUtils = require('./swap');
const { pair2coin } = require('./../../../utils/formatter');

function _parse(v) {
  return parseFloat(v, 10);
}
function exist(d) {
  return !!d;
}
const exchange = 'OKEX';

function final(f, l) {
  return (d) => {
    d = f(d, l);
    if (d) {
      for (const k in d) {
        if (d[k] === undefined) delete d[k];
      }
    }
    return d;
  };
}

function _getChanelObject(args, op = 'subscribe') {
  return { op, args };
}

function genInstrumentChanelFn(chanel) {
  return (o = {}) => {
    const { assets } = o;
    const args = [];
    _.forEach(assets, (asset) => {
      const { asset_type, pair } = asset;
      const instrument_id = futureUtils.getFutureInstrumentId(pair, asset_type);
      args.push(`${chanel}:${instrument_id}`);
    });
    return args;
  };
}


// 期货指数
const futureIndex = {
  name: 'index/ticker',
  isSign: false,
  notNull: [],
  chanel: (o = {}) => _.map(getPairs(o), p => `index/ticker:${p.replace('-USDT', '-USD')}`).filter(exist),
  formater: (res) => {
    if (!res) return [];
    const { data } = res;
    return _.map(data, (line) => {
      const { instrument_id: pair, timestamp, last } = line;
      return { pair, time: new Date(timestamp), price: _parse(last) };
    }).filter(d => d);
  }
};


// 现货tick
const ticks = {
  name: 'spot/ticker',
  isSign: false,
  notNull: [],
  chanel: (o = {}) => _.map(getPairs(o), p => `spot/ticker:${p}`),
  formater: res => _.map(res.data, final(spotUtils.formatTick)).filter(exist)
};

const futureTicks = {
  name: 'futures/ticker',
  notNull: [],
  isSign: false,
  chanel: genInstrumentChanelFn('futures/ticker'),
  formater: res => _.map(res.data, final(futureUtils.formatTick)).filter(exist)
};


// future Position
const futurePositions = {
  name: 'futures/position',
  notNull: [],
  isSign: true,
  chanel: genInstrumentChanelFn('futures/position'),
  formater: (res) => {
    return _.map(res.data, final(futureUtils.formatFuturePosition)).filter(exist);
  }
};

function getFutureAssetName(pair) {
  if (pair.endsWith('USDT')) return pair;
  return pair2coin(pair);
}

const futureBalances = {
  name: 'futures/account',
  notNull: [],
  isSign: true,
  chanel: (o = {}) => _.map(getPairs(o), pair => `futures/account:${getFutureAssetName(pair)}`),
  formater: (res) => {
    return _.flatten(_.map(res.data, (l) => {
      return _.map(l, futureUtils.formatBalance);
    }).filter(exist));
  }
};

const futureOrders = {
  name: 'futures/order',
  isSign: true,
  notNull: [],
  chanel: genInstrumentChanelFn('futures/order'),
  formater: res => _.map(res.data, final((a, b) => futureUtils.formatFutureOrder(a, b, 'ws futureOrders'))).filter(exist)
};

const spotOrders = {
  name: 'spot/order',
  notNull: [],
  isSign: true,
  chanel: o => _.map(getPairs(o), pair => `spot/order:${pair}`),
  formater: (res) => {
    return _.map(res.data, final(spotUtils.formatSpotOrder)).filter(exist);
  }
};

const futureDepth = {
  isSign: false,
  name: 'futures/depth5',
  chanel: genInstrumentChanelFn('futures/depth5'),
  notNull: [],
  formater: res => futureUtils.formatFutureDepth(res.data)
};

const spotDepth = {
  name: 'spot/depth5',
  notNull: [],
  isSign: false,
  chanel: o => _.map(getPairs(o), pair => `spot/depth5:${pair}`),
  formater: res => _.map(res.data, (d) => {
    if (!d) return null;
    const { instrument_id: pair, timestamp, asks, bids } = d;
    const res = {
      pair,
      exchange,
      asset_type: 'SPOT',
      time: new Date(timestamp),
      bids: spotUtils.formatDepth(bids),
      asks: spotUtils.formatDepth(asks),
    };
    res.instrument_id = ef.getInstrumentId(res);
    return res;
  }).filter(exist)
};

const spotBalances = {
  name: 'spot/account',
  notNull: [],
  chanel: (o) => {
    return _.map(getPairs(o), pair => `spot/account:${pair2coin(pair)}`);
  },
  isSign: true,
  formater: ds => _.map(ds.data, final(spotUtils.formatBalance))
};

const swapTicks = {
  name: 'swap/ticker',
  isSign: false,
  notNull: [],
  chanel: o => _.map(getPairs(o), pair => `swap/ticker:${pair}-SWAP`),
  formater: ds => _.map(ds.data, final(swapUtils.formatTick))
};


function getPairs(o) {
  if (o.assets) return _.map(o.assets, a => a.pair);
  if (o.pairs) return o.pairs;
}
const swapDepth = {
  name: 'swap/depth5',
  isSign: false,
  notNull: [],
  chanel: o => _.map(getPairs(o), pair => `swap/depth5:${pair}-SWAP`),
  formater: res => futureUtils.formatFutureDepth(res.data, 'swap')
};


const swapFundRate = {
  name: 'swap/funding_rate',
  isSign: false,
  notNull: [],
  chanel: o => _.map(getPairs(o), pair => `swap/funding_rate:${pair}-SWAP`),
  formater: (res) => {
    if (!res || !res.data) return null;
    const { data } = res;
    return _.map(data, (l) => {
      const pair = swapUtils.inst2pair(l.instrument_id);
      const coin = pair.split('-')[0];
      return {
        ...l,
        pair,
        time: new Date(),
        coin,
        funding_time: new Date(l.funding_time),
        settlement_time: new Date(l.settlement_time),
        funding_rate: _parse(l.funding_rate),
        estimated_rate: _parse(l.estimated_rate),
        interest_rate: _parse(l.interest_rate)
      };
    });
  }
};

const marginBalance = {
  name: 'spot/margin_account',
  notNull: [],
  isSign: true,
  chanel: (o = {}) => {
    return _.map(getPairs(o), (pair) => {
      const res = `spot/margin_account:${pair}`;
      return res;
    });
  },
  formater: (res) => {
    return _.flatten(_.map(res.data, marginUtils.formatMarginBalance).filter(exist));
  }
};

//
const swapBalances = {
  name: 'swap/account',
  notNull: [],
  isSign: true,
  chanel: (o = {}) => _.map(getPairs(o), pair => `swap/account:${pair}-SWAP`),
  formater: (res) => {
    if (res && res.data) return _.map(res.data, l => swapUtils.formatSwapBalance(l));
    return [];
  }
};

const swapPositions = {
  name: 'swap/position',
  notNull: [],
  isSign: true,
  chanel: (o = {}) => _.map(getPairs(o), pair => `swap/position:${pair}-SWAP`),
  formater: (res) => {
    if (res && res.data) return swapUtils.formatSwapPosition(res.data);
    return [];
  }
};

const swapOrders = {
  name: 'swap/order',
  notNull: [],
  isSign: true,
  chanel: (o = {}) => _.map(getPairs(o), pair => `swap/order:${pair}-SWAP`),
  formater: (res) => {
    if (res && res.data) return _.map(res.data, d => swapUtils.formatSwapOrder(d));
    return [];
  }
};

const swapEstimateFunding = {
  name: 'swap/funding_rate',
  notNull: [],
  isSign: false,
  chanel: o => _.map(getPairs(o), pair => `swap/funding_rate:${pair}-SWAP`),
  formater: (res) => {
    if (res && res.data) {
      const { instrument_id, interest_rate, estimated_rate, funding_rate } = res.data[0];
      const pair = instrument_id.replace('-SWAP', '');
      const h8 = 3600 * 1000 * 8;
      const current_funding_time = getSwapFundingTime({ exchange, asset_type: 'SWAP', pair });
      const next_funding_time = new Date(current_funding_time.getTime() + h8 * 2);
      const resp = formatter.wrapperInstrumentId({
        asset_type: 'SWAP',
        exchange,
        pair,
        time: new Date(),
        interest_rate: _parse(interest_rate),
        funding_rate: _parse(funding_rate),
        estimated_rate: _parse(estimated_rate),
        next_funding_time
      });
      return resp;
    }
    return [];
  }
};

module.exports = {
  marginBalance,
  swapEstimateFunding,
  ..._ws,
  // spot
  ticks,
  spotOrders,
  spotDepth,
  spotBalances,
  getChanelObject: _getChanelObject,
  // reqBalance,
  // future
  futureIndex,
  futureTicks,
  futureOrders,
  futureBalances,
  futureDepth,
  futurePositions,
  swapFundRate,
  swapTicks,
  swapDepth,
  swapBalances,
  swapPositions,
  swapOrders
};
