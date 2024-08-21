const express = require('express')
const app = express()
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const path = require('path')

app.use(express.json())

let db = null
const dbpath = path.join(__dirname, 'twitterClone.db')

const initializeDBandServer = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000')
    })
  } catch (error) {
    console.log(error.message)
  }
}

initializeDBandServer()

// Middleware for JWT token authentication
const authenticationToken = (request, response, next) => {
  const authHeader = request.headers['authorization']
  if (authHeader === undefined) {
    response.status(401).send('Invalid JWT Token')
    return
  }

  const jwtToken = authHeader.split(' ')[1]
  jwt.verify(jwtToken, 'My_SECRET_KEY', (error, payload) => {
    if (error) {
      response.status(401).send('Invalid JWT Token')
    } else {
      request.user = payload
      next()
    }
  })
}

// Function to get following people IDs
const getFollowingPeopleIdsOfUser = async username => {
  const getFollowingPeopleQuery = `
    SELECT following_user_id 
    FROM follower
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE user.username = ?;`

  const followingPeople = await db.all(getFollowingPeopleQuery, [username])
  const arrayOfId = followingPeople.map(eachUser => eachUser.following_user_id)
  return arrayOfId
}

// API 1: Register
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const dbUser = await db.get('SELECT * FROM user WHERE username = ?', [
    username,
  ])

  if (dbUser !== undefined) {
    response.status(400).send('User already exists')
  } else if (password.length < 6) {
    response.status(400).send('Password is too short')
  } else {
    const hashedPassword = await bcrypt.hash(password, 10)
    await db.run(
      'INSERT INTO user (username, password, name, gender) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, name, gender],
    )
    response.status(200).send('User Created Successfully')
  }
})

// API 2: Login
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const dbUser = await db.get('SELECT * FROM user WHERE username = ?', [
    username,
  ])

  if (dbUser === undefined) {
    response.status(400).send('Invalid user')
  } else {
    const isPasswordValid = await bcrypt.compare(password, dbUser.password)
    if (isPasswordValid) {
      const payload = {username: dbUser.username}
      const jwtToken = jwt.sign(payload, 'My_SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400).send('Invalid password')
    }
  }
})

// API 3: Get User Tweets Feed
app.get(
  '/user/tweets/feed/',
  authenticationToken,
  async (request, response) => {
    const {username} = request.user
    const followingIds = await getFollowingPeopleIdsOfUser(username) // Using the function to get following IDs

    const tweets = await db.all(`
    SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
    FROM tweet
    INNER JOIN user ON tweet.user_id = user.user_id
    WHERE tweet.user_id IN (${followingIds.join(',')})
    ORDER BY tweet.date_time DESC
    LIMIT 4`)

    response.send(tweets)
  },
)

// API 4: Get Following List
app.get('/user/following/', authenticationToken, async (request, response) => {
  const {username} = request.user
  const user = await db.get('SELECT user_id FROM user WHERE username = ?', [
    username,
  ])
  const userId = user.user_id

  const followingList = await db.all(
    `
    SELECT user.name
    FROM follower
    INNER JOIN user ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = ?`,
    [userId],
  )

  response.send(followingList)
})

// API 5: Get Followers List
app.get('/user/followers/', authenticationToken, async (request, response) => {
  const {username} = request.user
  const user = await db.get('SELECT user_id FROM user WHERE username = ?', [
    username,
  ])
  const userId = user.user_id

  const followers = await db.all(
    `
    SELECT user.name
    FROM follower
    INNER JOIN user ON follower.follower_user_id = user.user_id
    WHERE follower.following_user_id = ?`,
    [userId],
  )

  response.send(followers)
})

// API 6: Get Tweet Details
app.get('/tweets/:tweetId/', authenticationToken, async (request, response) => {
  const {tweetId} = request.params
  const {username} = request.user
  const user = await db.get('SELECT user_id FROM user WHERE username = ?', [
    username,
  ])
  const userId = user.user_id

  const isFollowing = await db.get(
    `
    SELECT 1
    FROM tweet
    INNER JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id = ? AND follower.follower_user_id = ?`,
    [tweetId, userId],
  )

  if (!isFollowing) {
    response.status(401).send('Invalid Request')
  } else {
    const tweetDetails = await db.get(
      `
      SELECT tweet.tweet, 
             COUNT(DISTINCT like.like_id) AS likes, 
             COUNT(DISTINCT reply.reply_id) AS replies, 
             tweet.date_time AS dateTime
      FROM tweet 
      LEFT JOIN like ON tweet.tweet_id = like.tweet_id
      LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
      WHERE tweet.tweet_id = ?
      GROUP BY tweet.tweet_id`,
      [tweetId],
    )

    response.send(tweetDetails)
  }
})

// API 7: Get Tweet Likes
app.get(
  '/tweets/:tweetId/likes/',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request.user
    const user = await db.get('SELECT user_id FROM user WHERE username = ?', [
      username,
    ])
    const userId = user.user_id

    const isFollowing = await db.get(
      `
    SELECT 1 
    FROM tweet
    INNER JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id = ? AND follower.follower_user_id = ?`,
      [tweetId, userId],
    )

    if (isFollowing === undefined) {
      response.status(401).send('Invalid Request')
    } else {
      const likes = await db.all(
        `
      SELECT user.username AS likes
      FROM like
      INNER JOIN user ON like.user_id = user.user_id
      WHERE like.tweet_id = ?`,
        [tweetId],
      )

      const usernames = likes.map(like => like.likes)
      response.send({likes: usernames})
    }
  },
)

// API 8: Get Tweet Replies
app.get(
  '/tweets/:tweetId/replies/',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request.user
    const user = await db.get('SELECT user_id FROM user WHERE username = ?', [
      username,
    ])
    const userId = user.user_id

    const isFollowing = await db.get(
      `
    SELECT 1 
    FROM tweet
    INNER JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id = ? AND follower.follower_user_id = ?`,
      [tweetId, userId],
    )

    if (isFollowing === undefined) {
      response.status(401).send('Invalid Request')
    } else {
      const replies = await db.all(
        `
      SELECT user.name, reply.reply
      FROM reply
      INNER JOIN user ON reply.user_id = user.user_id
      WHERE reply.tweet_id = ?`,
        [tweetId],
      )

      response.send({replies})
    }
  },
)

// API 9: Get User Tweets
app.get('/user/tweets/', authenticationToken, async (request, response) => {
  const {username} = request.user
  const user = await db.get('SELECT user_id FROM user WHERE username = ?', [
    username,
  ])
  const userId = user.user_id

  const tweets = await db.all(
    `
    SELECT tweet.tweet AS tweet, 
           tweet.date_time AS dateTime, 
           COUNT(DISTINCT like.like_id) AS likes, 
           COUNT(DISTINCT reply.reply_id) AS replies
    FROM tweet
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ?
    GROUP BY tweet.tweet_id`,
    [userId],
  )

  response.send(tweets)
})

// API 10: Create Tweet
app.post('/user/tweets/', authenticationToken, async (request, response) => {
  const {tweet} = request.body
  const {username} = request.user
  const user = await db.get('SELECT user_id FROM user WHERE username = ?', [
    username,
  ])
  const userId = user.user_id

  await db.run(
    'INSERT INTO tweet (tweet, user_id, date_time) VALUES (?, ?, ?)',
    [tweet, userId, new Date().toISOString()],
  )
  response.status(200).send('Tweet created successfully')
})

// API 11: Delete Tweet
app.delete(
  '/tweets/:tweetId/',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request.user
    const user = await db.get('SELECT user_id FROM user WHERE username = ?', [
      username,
    ])
    const userId = user.user_id

    const tweet = await db.get(
      'SELECT * FROM tweet WHERE tweet_id = ? AND user_id = ?',
      [tweetId, userId],
    )

    if (tweet === undefined) {
      response.status(401).send('Invalid Request')
    } else {
      await db.run('DELETE FROM tweet WHERE tweet_id = ?', [tweetId])
      response.status(200).send('Tweet Removed')
    }
  },
)

module.exports = app
