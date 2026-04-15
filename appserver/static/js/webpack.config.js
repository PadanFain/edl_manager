const path                 = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const SRC  = path.resolve(__dirname, 'src');
const DIST = path.resolve(__dirname, 'build');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    entry: `${SRC}/index.jsx`,
    output: { filename: 'edl_manager.bundle.js', path: DIST, clean: true },
    resolve: { extensions: ['.js', '.jsx'] },
    module: {
      rules: [
        { test: /\.(js|jsx)$/, exclude: /node_modules/,
          use: { loader: 'babel-loader', options: { presets: [
            ['@babel/preset-env', { targets: '> 1%, not dead' }],
            ['@babel/preset-react', { runtime: 'automatic' }],
          ]}}},
        { test: /\.css$/, use: [isProd ? MiniCssExtractPlugin.loader : 'style-loader', 'css-loader'] },
        { test: /\.svg$/, type: 'asset/inline' },
      ],
    },
    plugins: [...(isProd ? [new MiniCssExtractPlugin({ filename: 'edl_manager.bundle.css' })] : [])],
    devtool: isProd ? 'source-map' : 'eval-cheap-module-source-map',
    optimization: { splitChunks: false },
    performance: { hints: isProd ? 'warning' : false },
  };
};
