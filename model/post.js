import mongoose from "mongoose";
const Schema = mongoose.Schema;

const postSchema = new Schema(
  {
    title: {
      type: String,
      default: null,
    },
    media: [
      {
        url: String,
        mediaType: {
          type: String,
          enum: ["image", "video"],
        },
      },
    ],
    links: [
      {
        url: {
          type: String,
          validate: {
            validator: function (v) {
              return /^https?:\/\/.+/.test(v);
            },
            message: (props) => `${props.value} is not a valid URL!`,
          },
        },
        showPreview: {
          type: Boolean,
          default: true,
        },
      },
    ],

    // Channel information
    channel: {
      type: Schema.Types.ObjectId,
      ref: "SubChannel",
      required: true,
      index: true,
    },
    channelName: {
      type: String,
      required: true,
    },

    author: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    authorName: {
      type: String,
      required: true,
    },
    authorAvatar: String,

    likes: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "user",
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    likeCount: {
      type: Number,
      default: 0,
    },

    isEmbed:{
      type: Boolean,
      default: false,
    },

    comments: [
      {
        type: Schema.Types.ObjectId,
        ref: "Comment",
      },
    ],
    commentCount: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    isCommentingEnabled: {
      type: Boolean,
      default: false,
    },
    mentions: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);
postSchema.index({ channel: 1, createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ likes: 1 });

postSchema.virtual("isLiked").get(function () {
  return function (userId) {
    return this.likes.some((like) => like.user.equals(userId));
  };
});
postSchema.pre("save", async function (next) {
  if (this.isModified("likes")) {
    const User = mongoose.model("user");

    for (const like of this.likes) {
      // Agar username/avatar missing hai to fetch karo
      if (like.user) {
        const user = await User.findById(like.user).select("username avatar");
        if (user) {
          like.username = user.username;
          like.avatar = user.avatar;
        }
        console.log("Updated Like", like);
        console.log("Updated user", user);
      } else {
        console.log("Updated else Like", like);
      }
    }
  }
  console.log("saving post");
  next();
});
postSchema.pre("save", function (next) {
  if (this.isModified("likes")) {
    this.likeCount = this.likes.length;
  }
  next();
});

// // Static method to add a like
// postSchema.statics.addLike = async function (postId, userId, username, avatar) {
//   return this.findByIdAndUpdate(
//     postId,
//     {
//       $addToSet: {
//         likes: {
//           user: userId,
//           username: username,
//           avatar: avatar,
//           timestamp: new Date(),
//         },
//       },
//     },
//     { new: true }
//   );
// };

// // Static method to remove a like
// postSchema.statics.removeLike = async function (postId, userId) {
//   return this.findByIdAndUpdate(
//     postId,
//     {
//       $pull: {
//         likes: { user: userId },
//       },
//     },
//     { new: true }
//   );
// };

const Post = mongoose.model("Post", postSchema);

export default Post;
