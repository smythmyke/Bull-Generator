const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');

// Custom plugin to sanitize MV3-violating patterns from bundled output.
// These patterns come from third-party libraries (jszip/docx setImmediate polyfill,
// Firebase SDK feature detection) and are dead code in extension context, but
// Chrome Web Store's automated scanner flags them as "remotely hosted code."
class MV3SanitizePlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('MV3SanitizePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'MV3SanitizePlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE + 1,
        },
        (assets) => {
          for (const [name, asset] of Object.entries(assets)) {
            if (!name.endsWith('.js')) continue;
            let source = asset.source();
            if (typeof source !== 'string') continue;
            const original = source;

            // Replace: new Function("" + callback) -> safe alternative
            // Used by setImmediate polyfill for string-to-function conversion
            source = source.replace(
              /new Function\(""\s*\+\s*(\w+)\)/g,
              '(typeof $1==="function"?$1:function(){})'
            );

            // Replace: new Function("return this")() -> globalThis
            // Used by webpack runtime for global this detection
            source = source.replace(
              /new Function\("return this"\)\(\)/g,
              'globalThis'
            );

            // Replace: createElement("script") used for onreadystatechange timing hack
            // with a no-op div element (dead code in modern browsers)
            source = source.replace(/\.createElement\(["']script["']\)/g, '.createElement("div")');

            // Replace: typeof ...importScripts feature-detection checks
            // Firebase Auth and polyfills check for WorkerGlobalScope/importScripts
            // Chrome Web Store scanner flags these as "remotely hosted code"
            source = source.replace(
              /typeof\s+\w+\(\)\.importScripts/g,
              'typeof undefined'
            );
            source = source.replace(
              /\w+\.importScripts/g,
              'undefined'
            );

            // Replace: Function("binder","return function ("+joinArgs(l)+"){ return binder.apply(this,arguments); }")(...) -> bind polyfill
            // Used by function-bind/es5-shim, flagged as dynamic code generation
            // The full pattern builds a function dynamically with parameter names $0,$1,...
            // We replace it with Function.prototype.apply since the extension runs in modern Chrome
            source = source.replace(
              /Function\("binder","return function \("\+function\([^)]*\)\{[^}]*\}\([^)]*\)\+"\)\{ return binder\.apply\(this,arguments\); \}"\)/g,
              '(function(binder){return function(){return binder.apply(this,arguments)}})'
            );

            // Replace: Function("return function*() {}") -> generator detection
            // Feature detection that Chrome scanner flags
            source = source.replace(
              /Function\("return function\*\(\) \{\}"\)/g,
              '(function(){return null})'
            );

            // Replace: any remaining Function() constructor calls
            // Catches all patterns: Function("return this"),  =Function("..."), etc.
            source = source.replace(
              /\bFunction\("return this"\)\(\)/g,
              'globalThis'
            );
            source = source.replace(
              /([=,;(])Function\(("[^"]*"(?:,"[^"]*")*)\)/g,
              '$1(function(){return null}/*mv3-sanitized*/)'
            );

            // Replace: document.write(...) -> no-op
            // Used by jsPDF for new-window PDF rendering, not needed in extension
            source = source.replace(
              /\.document\.write\(/g,
              '.document.createElement("div"),void('
            );

            // Replace: innerHTML="<script>..." -> innerHTML=""
            // React DOM internal for creating script elements
            source = source.replace(
              /\.innerHTML="<script><\\\/script>"/g,
              '.innerHTML=""'
            );

            // Replace: MSApp.execUnsafeLocalFunction -> direct call
            // IE/Edge legacy API, dead code but flagged by scanner
            source = source.replace(
              /MSApp\.execUnsafeLocalFunction\(function\(\)\{return (\w+)\((\w+),(\w+)\)\}\)/g,
              '$1($2,$3)'
            );
            // Also catch: MSApp.execUnsafeLocalFunction?function(e,t,n,r){...}:ce pattern
            source = source.replace(
              /"undefined"!=typeof MSApp&&MSApp\.execUnsafeLocalFunction\?function\([^)]*\)\{[^}]*\}:/g,
              'false?function(){}:'
            );

            // Replace: "script"===n checks in React DOM createElement path
            // React checks tag name to handle script elements — replace with unreachable
            source = source.replace(
              /"script"===(\w+)\?\(\((\w+)=(\w+)\.createElement\("div"\)\)\.innerHTML="",\2=\2\.removeChild\(\2\.firstChild\)\)/g,
              'false?($2=$3.createElement("div"))'
            );

            if (source !== original) {
              compilation.updateAsset(name, new webpack.sources.RawSource(source));
            }
          }
        }
      );
    });
  }
}

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: {
      main: './src/index.tsx',
      results: './src/results/index.tsx',
      background: './src/background/index.ts',
      content: './src/content/index.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].bundle.js',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.jsx'],
      alias: {
        // Replace setimmediate polyfill with MV3-safe version
        // (original uses new Function() and createElement("script") which violate MV3 policy)
        'setimmediate': path.resolve(__dirname, 'src/polyfills/setImmediate.js'),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            'css-loader',
            'postcss-loader',
          ],
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(argv.mode || 'development'),
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      new HtmlWebpackPlugin({
        template: './public/index.html',
        filename: 'index.html',
        chunks: ['main'],
      }),
      new HtmlWebpackPlugin({
        template: './public/results.html',
        filename: 'results.html',
        chunks: ['results'],
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'manifest.json', to: 'manifest.json' },
          { from: 'icons', to: 'icons' },
        ],
      }),
      // Prevent async chunks that use createElement("script") for dynamic loading
      // which violates Chrome MV3 remotely hosted code policy
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 5, // 4 entry points + 1 shared vendors chunk
      }),
      // Sanitize remaining MV3-violating patterns from third-party code
      new MV3SanitizePlugin(),
    ],
    optimization: {
      splitChunks: {
        cacheGroups: {
          vendors: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: (chunk) => chunk.name === 'main' || chunk.name === 'results',
          },
        },
      },
    },
    devtool: isProduction ? false : 'cheap-module-source-map',
  };
};
