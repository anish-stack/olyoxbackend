const cloudinary = require("cloudinary").v2;
require("dotenv").config();
const fs = require("fs").promises;
const streamifier = require("streamifier");

cloudinary.config({
  cloud_name: "dsd8nepa5",
  api_key: "634914486911329",
  api_secret: "dOXqEsWHQMjHNJH_FU6_iHlUHBE",
});

const MAX_FILE_SIZE = 50000000; // 50 MB in bytes

const uploadSingleImage = async (fileInput,folder="image") => {
  try {
    if (Buffer.isBuffer(fileInput)) {
      // Validate file size for Buffer input
      if (fileInput.length > MAX_FILE_SIZE) {
        throw new Error(`File size too large. Got ${fileInput.length} bytes. Maximum allowed is ${MAX_FILE_SIZE} bytes.`);
      }
      // Use upload_stream for Buffer input
      return await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder:folder, resource_type: "auto" }, // auto detects image/video type
          (error, result) => {
            if (error) {
              console.error("Error during image upload:", error.message);
              return reject(new Error("Failed to upload Image"));
            }
            resolve({ image: result.secure_url, public_id: result.public_id });
          }
        );
        streamifier.createReadStream(fileInput).pipe(uploadStream);
      });
    }

    // Otherwise, assume fileInput is a string path
    if (typeof fileInput === "string") {
      // Check that the file exists
      await fs.access(fileInput);

      // Validate file size for file input
      const stats = await fs.stat(fileInput);
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`File size too large. Got ${stats.size} bytes. Maximum allowed is ${MAX_FILE_SIZE} bytes.`);
      }

      const result = await cloudinary.uploader.upload(fileInput, {
        folder: "images",
        resource_type: "auto", // Allows both images and videos
      });

      // Optionally delete the local file after upload
      try {
        await fs.unlink(fileInput);
        console.log("Local file deleted:", fileInput);
      } catch (unlinkError) {
        console.error("Error deleting local file:", unlinkError.message);
      }

      return { image: result.secure_url, public_id: result.public_id };
    }

    // If it's neither a Buffer nor a string, throw an error
    throw new Error("Invalid file input type. Expected a file path string or Buffer.");
  } catch (error) {
    console.error("Error during image upload:", error.message);
    throw new Error("Failed to upload Image");
  }
};

const deleteImage = async (public_id) => {
  try {
    await cloudinary.uploader.destroy(public_id);
    console.log("Image deleted successfully");
    return true;
  } catch (error) {
    console.error("Error deleting image:", error.message);
    throw new Error("Failed to delete image");
  }
};

module.exports = { uploadSingleImage, deleteImage };
