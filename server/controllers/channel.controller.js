import Channel from "../models/channel.model.js";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../utils/constants.js";
import { AsyncTryCatch } from "../middlewares/error.middlewares.js";
import {
  UpdateThumbnail,
  UploadSinglePhotoToCloudinary,
  UploadVideoAndThumbnail,
} from "../utils/features.js";
import { ErrorHandler, sortByKey } from "../utils/utility.js";
import Subscription from "../models/subscription.model.js";
import Video from "../models/video.model.js";
import Playlist from "../models/playlist.model.js";
import { v2 as cloudinary } from "cloudinary";
import mongoose from "mongoose";
import { emitNotification, io } from "../socket.js";
import Setting from "../models/setting.model.js";
import Notification from "../models/notification.model.js";

// const JWT_SECRET = process.env.JWT_SECRET || "default-secret";
// console.log(JWT_SECRET);

/// get self channel if logged in ************************************************************************************
export const getSelfChannelInfo = AsyncTryCatch(async (req, res, next) => {
  const channel = await Channel.findById(req.channelId)
    .select(
      "channelName email profilePhoto bio subscribersCount videosCount views playlists"
    )
    .populate("playlists", "name private");
  const dataToSend = {
    _id: channel._id,
    channelName: channel.channelName,
    email: channel.email,
    profilePhoto: channel.profilePhoto,
    bio: channel.bio,
    followers: channel.subscribersCount,
    videos: channel.videosCount,
    views: channel.views,
    watchLater: channel.playlists[0],
    playlists: channel.playlists,
  };

  res
    .status(200)
    .json({ message: "Channel Info fetched ", channel: dataToSend });
});

// get channel in general *******************************************************************************************
export const getChannelInfo = AsyncTryCatch(async (req, res, next) => {
  const { channelId } = req.params;
  console.log(channelId);
  let isOwner = false;
  let isSubscribed = false;
  let channelIdVisiting = null;

  try {
    const token = req.cookies.jwt;
    const decodedData = jwt.verify(token, JWT_SECRET);
    channelIdVisiting = decodedData.channelId;
    if (channelIdVisiting.toString() == channelId.toString()) {
      isOwner = true;
    }
  } catch (error) {
    console.log("cant send private videos");
  }
  const channel = await Channel.findById(channelId).select(
    "channelName email profilePhoto bio coverImage subscribersCount videosCount views"
  );

  if (channelIdVisiting && !isOwner) {
    isSubscribed = await Subscription.findOne({
      subscriber: channelIdVisiting,
      creator: channelId,
    });
  }
  // console.log(channel);
  if (!channel) next(new ErrorHandler(404, "Channel not found"));
  console.log("channel to be visiteed", channel);
  const dataToSend = {
    channelName: channel.channelName,
    email: channel.email,
    profilePhoto: channel.profilePhoto,
    bio: channel.bio,
    coverImage: channel.coverImage,
    followers: channel.subscribersCount,
    videos: channel.videosCount,
    views: channel.views,
    isOwner,
    isSubscribed: !!isSubscribed,
    isBell: isSubscribed?.bell,
  };

  res
    .status(200)
    .json({ message: "Channel Info fetched ", channel: dataToSend });
});

// update profile ********************************************************************************************
export const updateProfile = AsyncTryCatch(async (req, res, next) => {
  const { channelName, bio, password, profilePhotoUrl } = req.body;
  let profilePhoto = profilePhotoUrl;

  if (req.file) {
    profilePhoto = await UploadSinglePhotoToCloudinary(req);
  }

  const channel = await Channel.findByIdAndUpdate(
    req.channelId,
    {
      channelName,
      bio,
      password,
      profilePhoto,
    },
    { new: true, runValidators: true }
  );

  res
    .status(200)
    .json({ message: "Profile updated successfully", channel: channel });
});

// subscribe ************************************************************************************************
export const subscribeChannel = AsyncTryCatch(async (req, res, next) => {
  const { creatorId } = req.body;

  console.log("inside subsccribe");

  const channelToBeSubscribed = await Channel.findById(creatorId);

  if (!channelToBeSubscribed) next(new ErrorHandler(404, "Channel not found"));

  const isSubsriptionAlreadyExist = await Subscription.findOne({
    subscriber: req.channelId,
    creator: creatorId,
  });

  if (isSubsriptionAlreadyExist)
    return next(new ErrorHandler(400, "User already subscribed"));

  const newSubscription = new Subscription({
    subscriber: req.channelId,
    creator: creatorId,
    bell: true,
  });

  await newSubscription.save();

  console.log("subscribed")

  channelToBeSubscribed.followers.push(newSubscription._id);
  channelToBeSubscribed.subscribersCount =
    channelToBeSubscribed.subscribersCount + 1;
  await channelToBeSubscribed.save();

  await Channel.findByIdAndUpdate(req.channelId, {
    $push: { following: newSubscription._id },
  });

  const channelName = (await Channel.findById(req.channelId).select('channelName'))?.channelName

  const creatorSettings = await Setting.findById({ _id: channelToBeSubscribed.settings })

  console.log(channelName)
  // console.log(channelToBeSubscribed)

  if (creatorSettings && creatorSettings.newFollowerNotification) {

    const notification = new Notification({
      channel: creatorId,
      message: `<span style="color: #1DA1F2; font-weight: bold;">${channelName}</span> 
      subscribed your channel.`,
      isRead: false,
    })

    await notification.save()

    console.log("emitting new noti before")

    emitNotification(creatorId, {
      message: notification.message,
      channel: creatorId,
      isRead: false,
      createdAt: notification.createdAt,
    })


  }

  return res.status(200).json({ message: "Channel subscribed successfully" });
});


export const changeIsread = AsyncTryCatch(async (req, res, next) => {
  const { channelId } = req
  console.log('init')
  const { t } = req.query

  const notifications = await Notification.updateMany({ channel: channelId, createdAt: { $lte: new Date(t) } },
    { $set: { isRead: true } })


  res.status(200).json({ message: "Notifications updated successfully.", updatedCount: notifications.modifiedCount })
})


// unsubscribe ************************************************************************************************
export const unSubscribeChannel = AsyncTryCatch(async (req, res, next) => {
  const { creatorId } = req.body;

  console.log("in unsubscribe");
  console.log(creatorId);

  const channelToBeUnSubscribed = await Channel.findById(creatorId);

  if (!channelToBeUnSubscribed)
    return next(new ErrorHandler(404, "Channel does not exist anymore"));

  const subscription = await Subscription.findOneAndDelete({
    subscriber: req.channelId,
    creator: creatorId,
  });

  if (!subscription)
    return next(new ErrorHandler(400, "User already unsubscribed"));

  channelToBeUnSubscribed.followers = channelToBeUnSubscribed.followers.filter(
    (id) => !id.equals(subscription._id)
  );
  channelToBeUnSubscribed.subscribersCount -= 1;
  await channelToBeUnSubscribed.save();

  await Channel.findByIdAndUpdate(req.channelId, {
    $pull: { following: subscription._id },
  });

  return res.status(200).json({ message: "Channel unsubscribed successfully" });
});

// get VideosFromSubscribedChannel ****************************
export const getSubscribedChannelVideos = AsyncTryCatch(
  async (req, res, next) => {
    const { page = 1, limit = 20 } = req.query;
    const totalVideoCount = await Video.countDocuments();
    const totalPages = Math.ceil(totalVideoCount / limit) || 0;

    const channel = await Channel.findById(req.channelId).populate("following");

    const videos = await Video.find({
      channel: {
        $in: channel.following.map((follow) => follow.creator),
      },
      isPrivate: {
        $nin: true,
      },
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("channel", "channelName");

    return res
      .status(200)
      .json({ videos, totalPages, message: "fetched successfully" });
  }
);

export const getNotifications = AsyncTryCatch(async (req, res, next) => {
  const channelId = req.channelId

  const notifications = await Notification.find({ channel: channelId }).sort({ createdAt: 1 })

  // console.log(notifications)

  return res.status(200).json(notifications)
})

// get watch history **********************************************
export const getWatchHistory = AsyncTryCatch(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;
  let affectiveLimit = limit;
  const totalVideoCount = await Channel.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(String(req.channelId)) } },
    { $project: { watchHistoryCount: { $size: "$watchHistory" } } },
  ]);
  const totalCount = totalVideoCount[0].watchHistoryCount || 0;

  let temp = totalCount - page * limit;
  const skipValue = Math.max(0, temp);
  if (temp < 0) {
    affectiveLimit = parseInt(limit) + parseInt(temp);
  }

  const channel = await Channel.findById(req.channelId)
    .select("watchHistory")
    .populate({
      path: "watchHistory",
      options: {
        skip: skipValue,
        limit: parseInt(affectiveLimit),
      },
    });
  if (!channel) {
    return next(new ErrorHandler(404, "Error: Channel not found"));
  }
  const historyInOrder = channel.watchHistory.reverse();

  const totalPages = Math.ceil(totalCount / limit) || 0;

  res.status(200).json({ videos: historyInOrder, totalPages });
});

export const updateVideo = AsyncTryCatch(async (req, res, next) => {
  console.log("in upload video");
  // console.log("inside")
  const {
    title,
    description,
    channelId,
    isPrivate,
    canComment,
    category,
    duration,
    videoId,
  } = req.body;
  // console.log(channelId)
  // console.log(req.files.video)
  // console.log(req.files.thumbnail)
  let videoIfAvailable = null;
  // console.log(videoId?.length);
  if (videoId && videoId.toString() !== "null") {
    // console.log("in");
    videoIfAvailable = await Video.findById(videoId);
  }
  if (videoIfAvailable) {
    // console.log(channelId)
    // console.log(videoIfAvailable.channel)

    if (channelId !== videoIfAvailable.channel.toString()) {
      return next(
        new ErrorHandler(400, "Video does not belong to this channel")
      );
    }

    const updateFields = {
      title,
      description,
      isPrivate,
      canComment,
      category,
    };

    if (req.files.thumbnail) {
      //first adding the new thumbnail
      const { thumbnailUrlNew } = await UpdateThumbnail(req);

      updateFields.thumbnailUrl = thumbnailUrlNew;

      if (thumbnailUrlNew) {
        //if new thumbnail successfully added, deleting the older thumbnail
        function getPublicIdFromUrl(url) {
          // RegEx to extract the public ID from Cloudinary URL
          const regex = /\/upload\/(?:v\d+\/)?([^\/\.]+)/;
          const match = url.match(regex);

          if (match && match[1]) {
            return match[1]; // Return the public ID
          } else {
            return null; // Return null if no match is found
          }
        }

        // Example usage
        const url = videoIfAvailable.thumbnailUrl;
        const publicId = getPublicIdFromUrl(url);

        const deleteImageFromCloudinary = async (publicId) => {
          try {
            const result = await cloudinary.uploader.destroy(publicId);
            console.log("Image deleted successfully:", result);
          } catch (error) {
            console.error("Error deleting image:", error);
          }
        };

        deleteImageFromCloudinary(publicId);
      }
    }

    const updatedVideo = await Video.findByIdAndUpdate(videoId, updateFields, {
      new: true, // Return the updated document
      runValidators: true, // Apply schema validation
    });



    return res
      .status(201)
      .json({ message: "Video updated successfully", updatedVideo });
  }

  if (!req.files.thumbnail || !req.files.video || !title || !channelId) {
    return next(
      new ErrorHandler(400, "Please provide all the required fields")
    );
  }

  // console.log("inside2")

  const { videoUrlNew, thumbnailUrlNew } = await UploadVideoAndThumbnail(req);
  // console.log("inside3");

  const videonew = new Video({
    title,
    description,
    videoUrl: videoUrlNew,
    thumbnailUrl: thumbnailUrlNew,
    channel: channelId,
    isPrivate,
    canComment,
    category,
    duration,
  });

  console.log("done");
  await videonew.save();



  const channel = await Channel.findById(channelId);
  channel.videos.push(videonew._id);
  await channel.save();

  console.log('getting in')

  console.log(channel.followers)

  for (const follower of channel.followers) {

    const subscription = await Subscription.findById(follower)

    console.log(subscription)

    if (!subscription.bell) {
      continue
    }



    const notification = new Notification({
      channel: subscription.subscriber,
      message: `<span style="color: #1DA1F2; font-weight: bold;">${channel.channelName}</span> 
      has posted a new video:
      <span style="color: #FFD700; font-weight: bold;">${videonew.title}</span>`,
      isRead: false,
    })
    await notification.save()

    console.log('in noti')
    console.log(subscription.subscriber)
    emitNotification(subscription.subscriber.toString(), {
      message: notification.message,
      channel: subscription.subscriber,
      isRead: false,
      createdAt: notification.createdAt,
    })

  }

  return res
    .status(201)
    .json({ message: "Video uploaded successfully", videonew });
});

// get Channel Videoss *********************************************************************************
export const getChannelVideos = AsyncTryCatch(async (req, res, next) => {
  const channelIdForVideos = req.params.channelId;
  const { page = 0, limit = 20, sort = "createdAt_desc" } = req.query;
  let canSendPrivateVideos = false;
  // console.log("get channel page and sort", page, sort);
  const channelToFetchVideosFrom = await Channel.findById(
    channelIdForVideos
  ).populate("videos");
  if (!channelToFetchVideosFrom) {
    return next(new ErrorHandler(404, "Channel not found"));
  }

  // checking wheather the user asking for the videos can access the private videos

  try {
    const token = req.cookies.jwt;
    const decodedData = jwt.verify(token, JWT_SECRET);
    const channelIdVisiting = decodedData.channelId;
    if (channelIdVisiting.toString() == channelIdForVideos.toString()) {
      canSendPrivateVideos = true;
    }
  } catch (error) {
    console.log("cant send private videos");
  }
  let videosCanBeSent = channelToFetchVideosFrom.videos.filter(
    (vid) => !vid.isPrivate || canSendPrivateVideos
  );

  const [sortField, sortDirection] = sort.split("_"); // splits the sort string in the query parameter and takes the first two subarray from it and assign it to the corresponding variable

  const sortedVideos = sortByKey(videosCanBeSent, sortField, sortDirection); // function created in utitlity.js file can take name_acs, name_desc , views_acs, ...,createdAt_asc

  const startingIndex = parseInt(page, 10) * parseInt(limit, 10);

  let videosToSend = sortedVideos.slice(
    startingIndex,
    startingIndex + parseInt(limit, 10)
  );

  const totalPages = Math.ceil(sortedVideos.length / limit) || 0;
  res.status(200).json({
    message: "videos fetched successfully",
    totalPages,
    videos: videosToSend,
  });
});

// export const getPlaylistVideos = AsyncTryCatch(async (req, res, next) => {
//   const { playlistId } = req.query;

//   const token = req.cookies.jwt;
//   const decodedData = jwt.verify(token, JWT_SECRET);
//   const channelId = decodedData.channelId;

//   const playlist = await Playlist.findById(playlistId).populate({
//     path: "videos",
//     select: "title thumbnailUrl views duration channel",
//     populate: {
//       path: "channel", // Populating channel inside each video
//       select: "channelName profilePhoto", // Add fields you need
//     },
//   })
//     .populate("channel", "channelName");
//   console.log('intttttttt')
//   console.log(playlist)
//   if (playlist.private === true && (channelId.toString() !== playlist.channel._id.toString())) {
//     return next(new ErrorHandler(400, "Playlist is private"));

//   }
//   return res.status(200).json({ playlist });
// })

// toggle bell *********************************************************************************
export const toggleBell = AsyncTryCatch(async (req, res, next) => {
  const { creatorId } = req.body;
  const subscription = await Subscription.findOne({
    subscriber: req.channelId,
    creator: creatorId,
  });

  if (!subscription)
    return next(new ErrorHandler(404, "Subscription not found"));

  subscription.bell = !subscription.bell;
  await subscription.save();

  res.status(200).json({ success: true });
});

// get getSubscribedChannel *****************************************************************
export const getSubscribedChannel = AsyncTryCatch(async (req, res, next) => {
  const data = await Channel.findById(req.channelId)
    .select("following")
    .populate({
      path: "following",
      select: "creator bell",
      populate: {
        path: "creator",
        select: "channelName bio profilePhoto subscribersCount email",
      },
    });

  if (!data)
    return next(
      new ErrorHandler(404, "Data not found or something went wrong in server")
    );

  res.status(200).json({ following: data.following });
});

// get any channels playlist **********************************************************************************
export const getChannelPlaylists = AsyncTryCatch(async (req, res, next) => {
  const { channelId } = req.params;

  let canSendPrivatePlaylist = false;
  try {
    const token = req.cookies.jwt;
    const decodedData = jwt.verify(token, JWT_SECRET);
    const channelIdVisiting = decodedData.channelId;
    if (channelIdVisiting.toString() == channelId.toString()) {
      canSendPrivatePlaylist = true;
    }
  } catch (error) {
    console.log("cant send private playlist");
  }
  const x = await Channel.findById(channelId);
  // console.log("in playlist ", x);
  const channel = await Channel.findById(channelId)
    .select("playlists")
    .populate({
      path: "playlists",
      select: "name videos private",
      populate: {
        path: "videos",
        select: "thumbnailUrl",
      },
    })
    .sort({ updatedAt: -1 })
    .lean()
    .exec();

  if (!channel) return next(new ErrorHandler(404, "Channel not found"));

  let playlists = channel.playlists;
  // console.log("all play", playlists);
  if (!canSendPrivatePlaylist) {
    // console.log("in ");
    // console.log(playlists);
    playlists = playlists.filter((plist) => plist.private !== true);
  }
  // console.log("sendin ", playlists);

  const dataToSend = playlists.map((plist) => {
    const videoCount = plist.videos.length;
    const vids = plist.videos.slice(-3).reverse(); // only neccessory  the top three videos
    return { ...plist, videos: vids, videoCount };
  });

  res.status(200).json({ playlists: dataToSend });
});

// get my channels playlist **********************************************************************************
export const getMyPlaylists = AsyncTryCatch(async (req, res, next) => {
  const channelId = req.channelId;
  const channel = await Channel.findById(channelId)
    .select("playlists")
    .populate({ path: "playlists", select: "name private" });
  const playlists = channel.playlists;
  // console.log("chennel ", playlists);
  res.status(200).json({ playlists });
});
// Add to Playlist *************************************************************************
export const addVideosToPlaylist = AsyncTryCatch(async (req, res, next) => {
  const {
    playlistIds = [],
    name = "Untitled",
    isPrivate = true,
    videoId,
  } = req.body;
  if (!videoId) return next(new ErrorHandler(400, "Video not found"));

  // creating new playlist *****************************
  if (playlistIds.length === 0) {
    const newPlaylist = new Playlist({
      name,
      channel: req.channelId,
      videos: [videoId],
      videoCount: 1,
      private: isPrivate,
    });

    await newPlaylist.save();

    await Channel.findByIdAndUpdate(req.channelId, {
      $push: { playlists: newPlaylist },
    });

    return res.status(200).json({ success: true });
  }

  for (let i = 0; i < playlistIds.length; i++) {
    const playlist = await Playlist.findById(playlistIds[i]);

    if (!playlist) continue;

    if (!playlist.videos.includes(videoId)) {
      playlist.videos.push(videoId);
      playlist.videosCount += 1; // Increment video count
      await playlist.save(); // Save only once per playlist
    }
  }
  res.status(200).json({ success: true });
});

// get videso of playlist *****************************************************************
export const getPlaylistVideos = AsyncTryCatch(async (req, res, next) => {
  const { playlistId, page = 1, limit = 20 } = req.query;

  let affectiveLimit = limit;
  const playlistForVideoCount = await Playlist.findById(playlistId).select(
    "videosCount"
  );
  if (!playlistForVideoCount)
    return next(new ErrorHandler(404, "Error: Playlist not found"));
  const totalCount = playlistForVideoCount.videosCount || 0;
  let temp = totalCount - page * limit;
  const skipValue = Math.max(0, temp);
  if (temp < 0) {
    affectiveLimit = parseInt(limit) + parseInt(temp);
  }
  const playlist = await Playlist.findById(playlistId).populate({
    path: "videos",
    options: {
      skip: skipValue,
      limit: parseInt(affectiveLimit),
    },
  });

  playlist.videos = playlist.videos.reverse();

  const totalPages = Math.ceil(totalCount / limit) || 0;
  res.status(200).json({ playlist, totalPages });
});
