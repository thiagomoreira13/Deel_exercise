const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const { Op } = require("sequelize");
const {getProfile, getAdminProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * @returns contract by id
 */
app.get('/contracts/:id', async (req, res) =>{
	await getProfile(req, res, () => {})
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const contract = await Contract.findOne({where: {id}})
    if(!contract || contract.ContractorId != req.profile.id) return res.status(404).end()
    res.json(contract)
})

/**
 * @returns all active contracts
 */
app.get('/contracts', async (req, res) =>{
	await getProfile(req, res, () => {})
    const {Contract} = req.app.get('models')
    const contractList = await Contract.findAll({where: { 
	  [Op.and]: [
        { ContractorId: req.profile.id },
        { status: { [Op.not]: 'terminated' } }
      ] 
	}})
    res.json(contractList)
})

/**
 * @returns all active unpaid jobs, for active contracts only, for current user
 */
app.get('/jobs/unpaid', async (req, res) =>{
	await getProfile(req, res, () => {})
    const {Job, Contract} = req.app.get('models')
    const jobList = await Job.findAll({
      where: {paid: null },
      include: [{
        model: Contract,
        where: {
		  [Op.and]: [
            { ContractorId: req.profile.id },
            { status: { [Op.not]: 'terminated' } }
          ]
		}
      }]
    });
    res.json(jobList)
})

/**
 * Pay for a job. A client can only pay if his balance >= the amount to pay. The amount should be moved from the client's balance to the contractor balance.
 */
app.post('/jobs/:id/pay', async (req, res) =>{
	await getProfile(req, res, () => {})
    const {id} = req.params
    const {Job, Contract, Profile} = req.app.get('models')
    const job = await Job.findOne({where: {id}})
    const contract = await Contract.findOne({where: { id: job.ContractId } })
    const client = await Profile.findOne({where: { id: contract.ClientId } })
    const contractor = await Profile.findOne({where: { id: contract.ContractorId } })
	
	if (job.paid == true){
      return res.status(401).end()
	} else if (client.balance >= job.price){
	  const newClientBalance = client.balance - job.price
	  const newContractorBalance = contractor.balance + job.price
      await Profile.update({ balance: newClientBalance }, { where: { id: client.id } });
      await Profile.update({ balance: newContractorBalance }, { where: { id: contractor.id } });
	  
	  if (contract.status == "new") {
		await Contract.update({ status: "in_progress" }, { where: { id: contract.id } });
	  }

	  await Job.update({ paid: true, paymentDate: new Date() }, { where: { id: job.id } });

      res.send("Job payed as expected")
	} else {
      return res.status(401).end()
	}
})

/**
 * Deposits money into the the the balance of a client, a client can't deposit more than 25% his total of jobs to pay. (at the deposit moment)
 */
app.post('/balances/deposit/:userId', async (req, res) =>{
	await getProfile(req, res, () => {})
    const {userId} = req.params
    const {Job, Contract, Profile} = req.app.get('models')

    const client = await Profile.findOne({where: {userId}})
	const totalPriceToPay = await Job.sum('price', {
      where: {paid: null },
      include: [{
        model: Contract,
        where: {
		  [Op.and]: [
            { ClientId: client.id },
            { status: { [Op.not]: 'terminated' } }
          ]
		}
      }],
    });

    const depositValue = req.get('deposit_value')
    
	if (depositValue > totalPriceToPay * 0.25){
      return res.status(401).end()
	} else {
	  const newClientBalance = client.balance + depositValue
      await Profile.update({ balance: newClientBalance }, { where: { id: client.id } });
	  
      res.send("Deposit made as expected")
	}
})


/**
 * @returns the profession that earned the most money (sum of jobs paid) for any contactor that worked in the query time range.
 * 1. ***GET*** `/admin/best-profession?start=<date>&end=<date>` 
 */
app.get('/admin/best-profession', async (req, res) =>{
	await getAdminProfile(req, res, () => {})
	
	const startDate = req.query.start
	const endDate = req.query.end
	
	const { QueryTypes } = require('sequelize');
    const topProfession = await sequelize.query("SELECT profession FROM (SELECT profession, sum(price) AS earned FROM Profiles INNER JOIN Contracts ON Profiles.id = Contracts.ContractorId INNER JOIN Jobs ON Contracts.id = Jobs.ContractId AND Jobs.paid = TRUE AND Jobs.paymentDate >= " + startDate + " AND Jobs.paymentDate <= " + endDate + ") temp ORDER BY earned DESC LIMIT 1", { type: QueryTypes.SELECT });
	
    res.json(topProfession)
})

/**
 * @returns the clients the paid the most for jobs in the query time period. limit query parameter should be applied, default limit is 2.
 * 1. ***GET*** `/admin/best-clients?start=<date>&end=<date>&limit=<integer>` - 
 */
app.get('/admin/best-clients', async (req, res) =>{
	await getAdminProfile(req, res, () => {})

	const startDate = req.query.start
	const endDate = req.query.end
	const limit = req.query.limit

	const { QueryTypes } = require('sequelize');
    const topClients = await sequelize.query("SELECT firstName, lastName FROM (SELECT firstName, lastName, sum(price) AS payed FROM Profiles INNER JOIN Contracts ON Profiles.id = Contracts.ContractorId INNER JOIN Jobs ON Contracts.id = Jobs.ContractId AND Jobs.paid = TRUE AND Jobs.paymentDate >= " + startDate + " AND Jobs.paymentDate <= " + endDate + ") temp ORDER BY payed DESC LIMIT " + limit, { type: QueryTypes.SELECT });

    res.json(topClients)
})

module.exports = app;
