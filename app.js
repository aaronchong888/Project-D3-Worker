const SERVER_NAME = 'Worker0';	////// change this to some other names

var fs = require('fs');
var Web3 = require('web3');

/* Using Infura Ethereum node */
var WalletProvider = require('truffle-hdwallet-provider-privkey');
var privKey = "--YOUR ETH WALLET PRIVATE KEY--";	////// replace this with your own key
var wallet = new WalletProvider(privKey, "https://rinkeby.infura.io/--YOUR INFURA KEY--");	////// replace this with your own key
var web3 = new Web3(wallet.engine);
var coinbase = "--YOUR ETH WALLET ADDRESS--";	////// replace this with your own address

/* Uncomment and replace with these lines if you are hosting your own Ethereum node */
//var web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));
//var coinbase = web3.eth.accounts[0];	////// assume that you are using the first account

console.log("Using Eth Address: " + coinbase);

var request = require('request');
var abiDefinition = '';
var deployedAddress = '';
var IPFSStorage = '';

/* GET the contract ABI and address*/
request(
	{
		method: 'GET',
		url: 'https://project-d3.xyz/contract'
    }, function (error, response, body){
		if(!error && response.statusCode == 200){
			console.log(body);
			var jsonObject = JSON.parse(body);
			abiDefinition = jsonObject.abi;
			deployedAddress = jsonObject.contract;
			IPFSStorage = web3.eth.contract(abiDefinition).at(deployedAddress);
			console.log("Loaded Contract deployed at: " + deployedAddress);
		}
  	}
);

var ipfsAPI = require('ipfs-api');
var ipfs = ipfsAPI('ipfs.infura.io', '5001', {protocol: 'https'});
//var ipfs = ipfsAPI('localhost', '5001', {protocol: 'http'});	//////	Uncomment this line if you are hosting your own IPFS node
var ipfs_timeout = 30000; //milliseconds

var bs58 = require('bs58');
var express = require('express');
var morgan = require('morgan');
var bodyParser = require('body-parser');
var http = require('http');
var async = require('async');

var EthCrypto = require('eth-crypto');
var NodeRSA = require('node-rsa');
var key = new NodeRSA();
key.importKey(fs.readFileSync("./keys/privateKey.pem"));	////// replace this with your own RSA private key PATH
console.log("RSA Key loaded.");

/* Uncomment these lines if you need to generate a new RSA key pair */
//key.generateKeyPair(2048, 65537);
//fs.writeFileSync("privateKey.pem", key.exportKey('pkcs8-private-pem'));
//fs.writeFileSync("publicKey.pem", key.exportKey('pkcs8-public-pem'));
//console.log("RSA Key Pair saved.");

var app = express();
app.use(morgan('dev'));
app.use(bodyParser.urlencoded({'extended':'true'}));
app.use(bodyParser.json());

// Routes
app.get('/', function(req, res) {
	res.sendStatus(200);
});

app.post('/api/v1', function (req, res) {
	console.log(req.body);
	var fileID = req.body.id;
	var signature = req.body.signature;
	var signer = "0x0";

	if (signature !== undefined && signature !== null){
		signer = EthCrypto.recover(signature, web3.sha3("ProjectD3"));
		console.log('Request sent by: ' + signer);
		if (!isValidAddress(signer)){
			return res.status(400).send('Invalid signer address.');
		}
	} else {
		console.log('Request sent by Anonymous.');
	}

	IPFSStorage.getFileShares(fileID, signer, {from: coinbase, gas: 500000 }, function(err, data){
		if (err){
			console.log('getFileShares failed.');
			res.sendStatus(500);
		} else {
			console.log(data);
			if (data.length == 0){
				return res.sendStatus(500);
			} else {
				var completed = 0;
				data.forEach(function(item){
					var cat_success = false;
					ipfs.files.cat( bytes32ToIPFSHash(item), function (err, file) {
						console.log(file);
						cat_success = true;
						if (err) {
							console.log(err);
							return res.sendStatus(500);
						}
						try {
							var result = key.decrypt(file);
							// success, return the share
							return res.json({ share: result.toString('utf8') });
						}
						catch (err) {
							// not the correct key!
							console.log('key throw error..');
							completed++;
						}
						if (completed == data.length){
							return res.status(404).send(SERVER_NAME + ' no available share.');
						}
					});
					setTimeout(function(){
						if (!cat_success){
							console.log("IPFS Cat Timed out: " + item);
							completed++;
							if (completed == data.length){
								return res.status(500).send('IPFS timed out.');
							}
						}
					}, ipfs_timeout);
				});
			}
		}
	});
});

// Listen
var server = http.createServer(app);
var port = process.env.PORT || 8080;	////// change this to your custom port
server.listen(port);
console.log('App listening on port '+ port + '...');

//Helper functions
function bytes32ToIPFSHash(hash_hex) {
	var buf = new Buffer(hash_hex.replace(/^0x/, '1220'), 'hex')
	return bs58.encode(buf)
}

function isValidAddress(str) {
	return /^0x[a-fA-F0-9]{40}$/.test(str);
}
