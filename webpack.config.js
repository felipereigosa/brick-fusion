const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  devServer: {
    hot: false,
    liveReload: false,
  },

  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'assets', to: '' },
      ],
    }),

    new HtmlWebpackPlugin({
      template: './src/index.html',
    }),
  ],
};
