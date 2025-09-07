const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// AWS Configuration (Use environment variables for sensitive data)
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'ap-south-1'
});

const s3 = new AWS.S3();

// Function to validate file types
const isValidFile = (filePath) => {
    const validFileTypes = ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.pdf', '.webp'];
    const extname = path.extname(filePath).toLowerCase();
    return validFileTypes.includes(extname);
};

// Function to upload file to S3
const uploadFile = async (filePath, bucketName, key) => {
    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found at the specified path.');
        }

        // Validate file type
        if (!isValidFile(filePath)) {
            throw new Error('Invalid file format. Only jpeg, jpg, png, gif, bmp, pdf, and webp are allowed.');
        }

        // Read the file
        const fileContent = fs.readFileSync(filePath);

        // S3 upload parameters
        const params = {
            Bucket: bucketName,
            Key: key,
            Body: fileContent
        };

        // Set Content-Type based on file extension
        const fileExtension = path.extname(filePath).toLowerCase();
        switch (fileExtension) {
            case '.jpeg':
            case '.jpg':
                params.ContentType = 'image/jpeg';
                break;
            case '.png':
                params.ContentType = 'image/png';
                break;
            case '.gif':
                params.ContentType = 'image/gif';
                break;
            case '.bmp':
                params.ContentType = 'image/bmp';
                break;
            case '.pdf':
                params.ContentType = 'application/pdf';
                break;
            case '.webp':
                params.ContentType = 'image/webp';
                break;
            default:
                params.ContentType = 'application/octet-stream'; // Default content type
        }

        // Upload to S3
        const result = await s3.upload(params).promise();

        return result.Location; // Return the file URL
    } catch (error) {
        console.error('Error uploading file:', error.message);
        throw error; // Re-throw the error for the caller to handle
    }
};


const uploadBufferImage = async (buffer, mimeType, bucketName, key) => {
    try {
        // Validate MIME type
        if (!isValidFileType(mimeType)) {
            throw new Error('Invalid file format. Only jpeg, png, gif, webp, and pdf are allowed.');
        }

        // S3 upload parameters
        const params = {
            Bucket: bucketName,
            Key: key,
            Body: buffer,
            ContentType: mimeType
        };

        // Upload the buffer to S3
        const result = await s3.upload(params).promise();

        return result.Location; 
    } catch (error) {
        console.error('Error uploading buffer image:', error.message);
        throw error; // Re-throw the error for the caller to handle
    }
};

module.exports = {
    uploadFile: uploadFile,
    uploadBufferImage: uploadBufferImage
};
