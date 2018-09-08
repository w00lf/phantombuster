// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js, lib-LinkedIn.js"

const { parse, URL } = require("url")

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: true,
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
	height: (1700 + Math.round(Math.random() * 200)), // 1700 <=> 1900
})
const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)
const LinkedIn = require("./lib-LinkedIn")
const linkedIn = new LinkedIn(nick, buster, utils)
// }

const createUrl = (search, location) => {
	return (`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(search)}&location=${encodeURIComponent(location)}&sortBy=DD`)
}

const scrapeResultsAll = (arg, callback) => {
	const parseDateJob = (string, time) => {
		let number = Number(string.match(/^\d+/)[0])
		let modificatorString = string.match(/^\d+\s(\w+)/)[1]
		let modificators = {
			week: (time, number)=> new Date(time - number * 7 * 24 * 60 * 60 * 1000),
			month: (time, number)=> new Date(time.setMonth(time.getMonth() - number)),
			day: (time, number)=> new Date(time - number * 24 * 60 * 60 * 1000),
			year: (time, number)=> new Date(time.setYear(time.getFullYear() - number))
		}
		let modificator = Object.entries(modificators).find((n)=> modificatorString.match(n[0]))[1]
		return modificator(time, number)
	}
	let selectorAll = "ul.jobs-search-results__list > li"
	const results = document.querySelectorAll(selectorAll)
	const data = []
	for (const result of results) {
		let url
		let newInfos = {}
		if (result.querySelector("h3.job-card-search__title")) {
			newInfos.job_offer = result.querySelector("h3.job-card-search__title").textContent.trim()
		}
		if(!newInfos.job_offer.toLowerCase().match(arg.query.toLowerCase())) continue
		if (result.querySelector("div") && result.querySelector("div").dataset) {
			const jobId = result.querySelector("div").dataset.jobId
			newInfos.jobId = jobId
			newInfos.linkedin_job_url = "https://www.linkedin.com/jobs/view/" + jobId

		}
		let dateNowMidnight = new Date()
		dateNowMidnight.setHours(0,0,0,0)
		if(result.querySelector('.job-card-search__time-badge')) {
			// let string = result.querySelector('.job-card-search__time-badge').textContent.trim()
			// let number = Number(string.match(/^\d+/)[0])
			// let modificatorString = string.match(/^\d+\s(\w+)/)[1]
			// let modificators = {
			// 	week: (time, number)=> new Date(time - number * 7 * 24 * 60 * 60 * 1000),
			// 	month: (time, number)=> new Date(time.setMonth(time.getMonth() - number)),
			// 	day: (time, number)=> new Date(time - number * 24 * 60 * 60 * 1000),
			// 	year: (time, number)=> new Date(time.setYear(time.getFullYear() - number))
			// }
			// let modificator = Object.entries(modificators).find((n)=> modificatorString.match(n[0]))[1]
			// newInfos.date = modificator(dateNowMidnight, number)
			newInfos.date = parseDateJob(result.querySelector('.job-card-search__time-badge').textContent.trim(), dateNowMidnight).toString()
		} else if(result.querySelector(".job-card-search__new-tag")) {
			newInfos.date = dateNowMidnight.toString()
		} else {
			newInfos.date = 'unknown'
		}

		if (result.querySelector("h4.job-card-search__company-name")) {
			newInfos.company = result.querySelector("h4.job-card-search__company-name").textContent
		}
		if (result.querySelector("h3.job-card-search__title")) {
			newInfos.linkedin_company_url = result.querySelector(".job-card-search__company-name-link.ember-view").href
		}
		data.push(newInfos)
	}
	callback(null, data)

}


/**
 * @description Extract &page= value if present in the URL
 * @param {String} url - URL to inspect
 * @return {Number} Page index found in the given url (if not found return 1)
 */
const extractPageIndex = url => {
	let parsedUrl = new URL(url)
	return parsedUrl.searchParams.get("page") ? parseInt(parsedUrl.searchParams.get("page"), 10) : 1
}

/**
 * @description Tiny wrapper used to easly change the page index of LinkedIn search results
 * @param {String} url
 * @param {Number} index - Page index
 * @return {String} URL with the new page index
 */
const overridePageIndex = (url, index) => {
	try {
		let parsedUrl = new URL(url)
		parsedUrl.searchParams.set("start", (index - 1) * 25)
		return parsedUrl.toString()
	} catch (err) {
		return url
	}
}

const getSearchResults = async (tab, searchUrl, numberOfPage, query) => {
	utils.log(`Getting data from ${searchUrl} ...`, "loading")
	let result = []
	const selectors = ["div.search-no-results__container", "div.search-results-container", ".jobs-search-no-results", ".jobs-search-results__list"]
	let stepCounter = 1
	let i
	try {
		i = extractPageIndex(searchUrl)	// Starting to a given index otherwise first page
	} catch (err) {
		utils.log(`Can't scrape ${searchUrl} due to: ${err.message || err}`, "error")
		return result
	}

	for (; stepCounter <= numberOfPage; i++, stepCounter++) {
		utils.log(`Getting data from page ${i}...`, "loading")
		await tab.open(overridePageIndex(searchUrl, i))
		let selector
		try {
			selector = await tab.waitUntilVisible(selectors, 15000, "or")
		} catch (err) {
			// No need to go any further, if the API can't determine if there are (or not) results in the opened page
			utils.log(err.message || err, "warning")
			return result
		}
		if (selector === selectors[0] || selector === selectors[2]) {
			utils.log("No result on that page.", "done")
			break
		} else {
			let selectorList
			selectorList = "ul.jobs-search-results__list > li"
			const resultCount = await tab.evaluate((arg, callback) => {
				callback(null, document.querySelectorAll(arg.selectorList).length)
			}, { selectorList })
			let canScroll = true
			for (let i = 1; i <= resultCount; i++) {
				try {
					await tab.evaluate((arg, callback) => { // scroll one by one to correctly load images
						if (document.querySelector(`${arg.selectorList}:nth-child(${arg.i})`)) {
							callback(null, document.querySelector(`${arg.selectorList}:nth-child(${arg.i})`).scrollIntoView())
						}
					}, { i, selectorList })
					await tab.wait(100)
				} catch (err) {
					utils.log("Can't scroll into the page, it seems you've reached LinkedIn commercial search limit.", "warning")
					canScroll = false
					break
				}
			}
			if (canScroll) {
				result = result.concat(await tab.evaluate(scrapeResultsAll, { query }))
			} else {
				break
			}
			let hasReachedLimit = await linkedIn.hasReachedCommercialLimit(tab)
			if (hasReachedLimit) {
				utils.log(hasReachedLimit, "warning")
				break
			} else {
				utils.log(`Got URLs for page ${i}.`, "done")
			}
		}
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(timeLeft.message, "warning")
			return result
		}
	}
	utils.log("All pages with result scrapped.", "done")
	return result
}

const isLinkedInSearchURL = (targetUrl) => {
	const urlObject = parse(targetUrl)

	if (urlObject && urlObject.hostname) {
		if (urlObject.hostname === "www.linkedin.com" && (urlObject.pathname.startsWith("/search/results/") || urlObject.pathname.startsWith("/jobs/search/"))) {
			if (urlObject.pathname.includes("people")) { return "people" } // People search
			if (urlObject.pathname.includes("companies")) { return "companies" } // Companies search
			if (urlObject.pathname.includes("groups")) { return "groups" } // Groups search
			if (urlObject.pathname.includes("schools")) { return "schools" } // Schools search
			if (urlObject.pathname.includes("jobs")) { return "jobs" } // Jobs search
		}
	}
	return 0
}

const setLinkeDinPageView = async (tab) => {
	await tab.open('https://www.linkedin.com/')
	await tab.evaluate((arg, callback) => {
		callback(null, localStorage.setItem('voyager-web:jobsSearch__disableTwoPane', true))
	}, {})
}

;(async () => {
	const arg = buster.argument;

	const tab = await nick.newTab()
	const search = arg.search
	const city = arg.city
	const sessionCookie = arg.session_cookie
	const numberOfPage = arg.number_of_page || 1

	if (!search || !city || !sessionCookie) {
		utils.log("Required arguments are not set: search, city and session_cookie", "error")
		nick.exit(1)
	}
	await linkedIn.login(tab, sessionCookie)
	let result = []
	await setLinkeDinPageView(tab)
	searchUrl = createUrl(search, city)
	utils.log(`Scrapping ${searchUrl}`, "info")
	result = result.concat(await getSearchResults(tab, searchUrl, numberOfPage, search))
	await linkedIn.saveCookie()
	await utils.saveResults(result, result)
	nick.exit(0)
})()
	.catch(err => {
		utils.log(err, "error")
		nick.exit(1)
	})
