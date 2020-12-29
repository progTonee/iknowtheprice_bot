const cheerio = require('cheerio');
const translate = require('translatte');
const BotError = require('../config/error-handler');
const {
  HEADERS_SELECTOR,
  LIST_SELECTOR,
  NEW_LINE_SYMBOLS,
  AVERAGE_PRICE,
  UNSUTABLE_TRANSLATE_SYMBOLS
} = require('../constants/constants');
const { getConvertingCurrencyValue, getCurrentCurrencySign } = require('./currency.utils');

const removeUnnecessaryCharactersFromPrice = price => {
  return price.match(/[0-9]+.[0-9]+/).join('');
};

const removeNewLinesTralingLeadingSpaces = data => {
  return data.replace(NEW_LINE_SYMBOLS, '').trim();
};

const prepareTranslatedData = translatedData => {
  const preparedTranslatedData = translatedData.match(UNSUTABLE_TRANSLATE_SYMBOLS)[0];

  return preparedTranslatedData.toLowerCase();
};

const getAveragePriceForTwoPersons = averagePriceText => {
  const deafultDigitsAfterDot = '00';
  const averagePriceParts = averagePriceText.match(/[0-9]+/g);

  return `${averagePriceParts[0]}.${averagePriceParts[1] ? averagePriceParts[1] : deafultDigitsAfterDot}`;
};

const getAveragePriceForPersons = (averagePriceForTwoPersons, amountOfPersons) => {
  const averagePriceForOnePerson = (averagePriceForTwoPersons / 2).toFixed(2);
  const averagePriceForPersons = (averagePriceForOnePerson * amountOfPersons).toFixed(2);

  return +averagePriceForPersons;
};

const getPreparedAveragePriceResponse = (averagePriceText, averagePriceForPersons, averagePriceReplacementTextPart) => {
  let preparedAveragePriceResponse;

  preparedAveragePriceResponse = averagePriceText.replace(averagePriceReplacementTextPart, '');
  preparedAveragePriceResponse = preparedAveragePriceResponse.replace(/[0-9]+.[0-9]+/, averagePriceForPersons);
  preparedAveragePriceResponse = preparedAveragePriceResponse.replace(/ {2,}/, ' ');

  return preparedAveragePriceResponse;
};

const getHeadersData = ($, i18n) => {
  const headers = [];

  $(HEADERS_SELECTOR).each((i, elem) => {
    headers.push({ text: $(elem).text().trim() });
  });

  if (headers.length) {
    return headers;
  } else {
    throw new BotError(i18n.t('parsingPageError'), true);
  }
};

const getListData = ($, i18n, session) => {
  const list = [];

  $(LIST_SELECTOR).each((i, goodWrapperElement) => {
    const options = {};
    const prevTag = $(goodWrapperElement).prev()[0].tagName;

    $(goodWrapperElement).children('.col-good-title').each((i, goodTitleElement) => {
      options.goodTitle = removeNewLinesTralingLeadingSpaces($(goodTitleElement).text());
    });

    $(goodWrapperElement)
      .children('.col-price')
      .each((index, goodPriceElement) => {
        let priceResult;

        priceResult = $(goodPriceElement).text();
        priceResult = removeNewLinesTralingLeadingSpaces(priceResult);
        priceResult = removeUnnecessaryCharactersFromPrice(priceResult);
        priceResult = priceResult.split(',').join('');

        options.goodPrice = priceResult;
        options.goodPriceCurrency = getCurrentCurrencySign(session.priceListCurrencyCode);
      });
    
    if (prevTag === 'h3') {
      list.push([options]);
    } else {
      list[list.length - 1].push(options);
    }
  });

  if (list.length) {
    return list;
  } else {
    throw new BotError(i18n.t('parsingPageError'), true);
  }
};

const getPriceList = async (page, i18n, session) => {
  const $ = cheerio.load(page);
  const headers = getHeadersData($, i18n);
  const list = getListData($, i18n, session);
  const currencyValuesPromises = [];
  const priceList = [];

  headers.forEach((header, index) => {
    list[index].map(good => {
      if (!currencyValuesPromises[index]) {
        currencyValuesPromises[index] = [];
      }
      
      currencyValuesPromises[index].push(getConvertingCurrencyValue(i18n.languageCode, session.priceListCurrencyCode, good.goodPrice));
    });
  });

  return Promise.all(currencyValuesPromises.map(Promise.all, Promise)).then(convertedPrices => {
    headers.forEach((header, heaederIndex) => {
      const headerTitle = `<b>${header.text}:</b>\n\n`;
      const goodPrice = list[heaederIndex].map((good, goodIndex) => {
        const { goodTitle, goodPriceCurrency } = good;
        const convertedPrice = convertedPrices[heaederIndex][goodIndex];

        return `${goodTitle} - ${convertedPrice}${goodPriceCurrency}`;
      });

      priceList.push(headerTitle + goodPrice.join('\n'));
    });

    return priceList;
  });
};

const getPageUrl = (pageUrl, language, country, city) => {
  let url;

  if (language === 'en') {
    url = `${pageUrl}/country/${country}/city/${city}/cost-of-living`;
  } else {
    const protocol = pageUrl.slice(0, 8);
    const domain = pageUrl.slice(8);

    url = `${protocol}${language}.${domain}/country/${country}/city/${city}/cost-of-living`;
  }

  return url;
};

const getInformationForAPlace = async (incommingPlace, i18n, sessionAmountOfPersons) => {
  const incorrectPlaceName = i18n.t('incorrectPlaceName');
  const [country, city, incommingAmountOfPersons] = incommingPlace.split(',').map(value => value.trim());
  let amountOfPersons = sessionAmountOfPersons;

  if (!country || !city) {
    throw new BotError(incorrectPlaceName, true);
  }
  if (incommingAmountOfPersons) {
    amountOfPersons = incommingAmountOfPersons;
  }

  const translatedCountry = await translate(country, { to: 'en' });
  const translatedCity = await translate(city, { to: 'en' });

  return {
    country: prepareTranslatedData(translatedCountry.text),
    city: prepareTranslatedData(translatedCity.text),
    amountOfPersons
  };
};

const getAveragePrice = (page, amountOfPersons, averagePriceReplacementTextPart) => {
  const $ = cheerio.load(page);
  const averagePriceText = `<b>${removeNewLinesTralingLeadingSpaces($($(AVERAGE_PRICE)[0]).text())}</b>`;
  const averagePriceForTwoPersons = getAveragePriceForTwoPersons(averagePriceText);
  const averagePriceForPersons = getAveragePriceForPersons(averagePriceForTwoPersons, amountOfPersons);
  const averagePriceResponse = getPreparedAveragePriceResponse(averagePriceText, averagePriceForPersons, averagePriceReplacementTextPart);

  return averagePriceResponse;
};

const replyWithHTML = async (ctx, data) => {
  ctx.replyWithHTML(data);
};

module.exports = {
  getPriceList,
  getPageUrl,
  getInformationForAPlace,
  getAveragePrice,
  replyWithHTML,
  prepareTranslatedData,
  getAveragePriceForTwoPersons,
  removeNewLinesTralingLeadingSpaces,
  getAveragePriceForPersons,
  getPreparedAveragePriceResponse
};