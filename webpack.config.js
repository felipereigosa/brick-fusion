const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  devServer: {
    hot: true,
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
