# Project: Ricettario

## 1. What is this project?
The aim is to create an web app to manage cooking recipes.
The user must be able to import a recipe from a website just providing the URL. The system must scan the entire page and detect:
- the list of ingredients with quantity/weight
- the preparation steps

For each recipe the system must estimate the time necessary for each step. When the customer selects one of the saved recpies, they can click on a "Start cooking" button that makes a timer start with milestones at each step. 
For example, if the recipe has 4 steps and the estimate time for the first one is 2 minutes and for the second one is 6 minutes, the portal must show the first step when the clock starts. After 2 minutes, it automatically switch to step 2 and after additional 6 minutes and so on.

The home page must show the list of all saved recipes, each having a title and the total estimated duration. If the original recpie showed also a "complexity rate", also this one must be shown.
When clicking on a recipe, this is opened in the main page showing all the details. At the top-right corner a link to the original source must be shown.

If possible, extracting receipes from YouTube videos, Instagram and Facebook reels would be perfect. 

