CR-Cast
=======

Chromecast Emulator for Google Chrome

**IMPORTANT:** CR Cast does **not** work on the current version of the Google Cast SDK. That means it won't work for casting modern chromecast apps and it won't work for developing new ones. Some small progress has been made in supporting the new API but no luck yet in implementing "casts://" protocol running on port 8009. The traffic through this appears to be encrypted.

There appears to be an implementation in node, which could be helpful for someone with the time to update CR-Cast based on that: https://github.com/thibauts/node-castv2

Documentation of the Chromecast Implementation can be found [here](https://github.com/jloutsenhizer/CR-Cast/wiki/Chromecast-Implementation-Documentation-WIP)
