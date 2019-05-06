const router = require('express').Router();
const winston = require('winston');
const consts = require('./consts.js');
const Endpoint = require('./objects/Endpoint.js');

winston.level = consts.LOG_LEVEL;

const defaultMiddleware = (res, req, next) => next();

const rain = (apiConfig) => {

    const versions = {};
    let previousApiVersion = null;

    for (let apiVersion in apiConfig) {
        if (apiConfig.hasOwnProperty(apiVersion)) {
            let apiVersionConfig = apiConfig[apiVersion];

            let apiVersionActive = apiVersionConfig.active;
            // use default value if not found
            if (apiVersionActive == null) apiVersionActive = true;

            let apiVersionDeprecated = apiVersionConfig.deprecated;
            // use default value if not found
            if (apiVersionDeprecated == null) apiVersionDeprecated = false;

            delete apiVersionConfig.active;
            delete apiVersionConfig.deprecated;
            versions[apiVersion] = [];

            // copy over endpoints from previous version if needed
            inheritEndpoints(versions, previousApiVersion, apiVersion);

            // set previous api version number
            previousApiVersion = apiVersion;

            for (let i = 0; i < apiVersionConfig.endpoints.length; i++) {
                let endpointActive = apiVersionConfig.endpoints[i].active;
                // use default value if not found
                if (endpointActive == null) endpointActive = true;

                let endpointDeprecated = apiVersionConfig.endpoints[i].deprecated;
                // use default value if not found
                if (endpointDeprecated == null) endpointDeprecated = false;

                apiVersionConfig.endpoints[i].active = endpointActive && apiVersionActive;
                apiVersionConfig.endpoints[i].deprecated = endpointDeprecated || apiVersionDeprecated;
                let endpoint = new Endpoint(apiVersion, apiVersionConfig.endpoints[i]);
                endpoint.config.middleware = [...[defaultMiddleware], ...(endpoint.config.middleware || [])];
                // add new endpoint to the list or replace if it exists already
                pushOrReplaceRoute(versions[apiVersion], endpoint);
            }
        }
    }

    return populateRouter(versions);
};

function inheritEndpoints(versions, previousApiVersion, apiVersion) {
    if (previousApiVersion == null) {
        return;
    }

    for (let i = 0; i < versions[previousApiVersion].length; i++) {
        if (!versions[previousApiVersion][i].config.deprecated) {
            let endpointCopy = { ...versions[previousApiVersion][i] };
            endpointCopy.apiVersion = apiVersion;
            endpointCopy.config.active = true;
            versions[apiVersion].push(endpointCopy);
        }
    }
}

function pushOrReplaceRoute(endpoints, endpoint) {
    let replaced = false;
    for (let i = 0; i < endpoints.length; i++) {
        if (endpoints[i].config.route == endpoint.config.route
            && endpoints[i].config.method == endpoint.config.method) {
            endpoints[i] = endpoint;
            replaced = true;
        }
    }

    if (!replaced) {
        endpoints.push(endpoint);
    }
}

function populateRouter(versions) {
    for (let apiVersion in versions) {
        if (versions.hasOwnProperty(apiVersion)) {
            winston.debug(`Start of API version`, apiVersion);
            for (let i = 0; i < versions[apiVersion].length; i++) {
                if (versions[apiVersion][i].config.active) {
                    constructRoute(versions[apiVersion][i]);
                }
            }
            winston.debug(`End of API version`, apiVersion, "\n");
        }
    }

    return router;
}

function constructRoute(endpoint) {
    const RouteFunction = (req, res, next) => {
            req.apiVersion = endpoint.apiVersion;
            if (endpoint.config.hasOwnProperty('validation')) {
              const validation = endpoint.config.validation(req, res, next);
              if (!validation.success) {
                return res.status(422).json({ success: false, error: {
                    message: validation.message,
                  },
                });
              }
            }
            return endpoint.config.implementation(req, res, next);
        },
        endpointURL = `/${endpoint.apiVersion}${endpoint.config.route}`;

    if(!consts.HTTP_METHODS.includes(endpoint.config.method)){
        winston.error(`HTTP Method not recognised! '${endpoint.config.method} ${endpointURL}'`);
        return;
    }
    winston.debug(`Adding route '${endpoint.config.method} ${endpointURL}'`);
    router[endpoint.config.method.toLowerCase()](endpointURL, endpoint.config.middleware, RouteFunction);
}

module.exports = {
    rain: rain
};
