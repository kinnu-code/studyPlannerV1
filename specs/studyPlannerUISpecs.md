# Smart Study Planner — UI Specification v0.2
A prerequesite document that needs to be considered before this one is the 'studyPlannerLogicSpecs.md'


## Main options
1. Start a new plan
2. Update existing plan

### 1. Start a new plan
1. The user is asked to either just enter an axam name and leave it to AI to determine the topics at a granual study sessions level, or (in addition to the mandatory exam name) to upload a file whith either relatively high level topics which will still be passed to AI to provide more details (suptopics and durations), or at a granular study session topics. In all cases AI will examine those and based on its knowledge base assign a small, medium, or long session requirement for each (see studyPlannerLogicSpecs.md)
2. Exam date and start of studying date
3. Weakly study schedule. This should show a days of the week table with the ability to state how many short and long sessions to done each day of the week
4. A generate button that will also save the generated plan. This will generate the visual and table outputs as in the logic specs document and asks the user to save them. This will also save a document associated with the plan (same name) but with .cfg extention which is a json with all the user input information and configuration settings used when generating that plan
5. User is immediately asked if they are happy with the plan or want to update it. In case of update, the logic in ### 2 is followed

### 2. Update existing plan
If the user just generated the plan and it is still in memory, then use that, if not, then the user is asked to select the plan and its associated .cfg settings file for upload and analysis to be used for the upate
See section ## 10 (replanning) in the specs for what is needed for this interface

### 3. Configure settings
User can change the settings of the following parameters
- Spaced repetition intervals. Default spacing is 1,6,16,45,131 which refers to the space between each review, not the day of the review
- Final target state: Healty or Mastery (show brief description of what each means to the user)
- How long is a short and long session: Defaults are 25 minutes for short and 60 minutes for long
- Number of MCQ sessions on a topi to become healthy
- Number of MCQ sessions on a topi to reach mastery
- Minumum number of spaced repetition repeats for mastery
- The full time estimates table for all activities in their short, medium and long options