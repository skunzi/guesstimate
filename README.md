# Guesstimate

## Concept

* browser based game
* static webpage
* different types of guessing categories
* each day a different category is used (categories change on a fixed cycle)
* 4 photos are shown each day
* How many?
  * show a photo and the user should guess the count
  * Stadium, theater, lecture hall, concert hall (capacity)
  * Vehicles like cars, trains, airplan, ships (seats)
* How tall?
  * show a photo and the user should guess the height
  * Buildings, Bridges, Monuments
  * Mountains
* How old?
  * show a photo and the user should guess the age
  * Buildings, Vehicle
  * Historical artefacts
  * People
* The closer the guess the more points
* Correct guess: 1000 points
* The worse the guess to less points
* Every day one new round is released
* The player can play the previously released rounds and select each day in a calendar
* The player can see which day was already played
* Streak tracking: Beyond average/best/worst, track consecutive days played.
* Statistic view is available (average points, best round, worst round)
* each question has also a difficulty rating (not shown to the user, only for balancing a day)

## UX
* Input UX: Consider a slider or number input with appropriate range hints (e.g., "guess between 1,000 and 200,000")
* Feedback/reveal: After guessing, show the answer with a fun fact or context 
* reveal photos one at a time. Let the player guess after each — later photos could be easier (closer shot, different angle)

## Technical details

* use localStorage for user statistic
* A rounds.json file mapping dates → questions → photo files + answers + fun facts

## Technical questions

* one photo might be used in different categories
