const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const articleSchema = new Schema({
  username1:String,
  username2:String,
  email:String,
  password:String,
},{ timestamps: true });
const Article = mongoose.model("myData", articleSchema);
module.exports = Article;