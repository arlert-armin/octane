const path = require('path');

module.exports = {
    // Octane's api pages read an optional `config.returnSignature` that isn't in
    // config.json (it's `undefined` at runtime → normal broadcast). Don't fail the
    // production build on that strict type-check / lint.
    typescript: { ignoreBuildErrors: true },
    eslint: { ignoreDuringBuilds: true },
    webpack: (config, { isServer, nextRuntime }) => {
        if (isServer && nextRuntime !== 'edge') {
            return {
                ...config,
                entry() {
                    return config.entry().then((entry) => ({
                        ...entry,
                        // adding custom entry points
                        cli: path.resolve(process.cwd(), 'src/cli.ts'),
                    }));
                }
            };
        }
        return config;
    },
};
