import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuid4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { PrismaClient, Video } from '@prisma/client';
import { Storage } from 'megajs';
import { error, log } from 'console';

const app = express();
const prisma = new PrismaClient();

// Interface for Mega configuration
interface MegaConfig {
    email: string;
    password: string;
}

// Storage configuration for Mega
const mega = new Storage({
    email: process.env.MEGA_EMAIL as string,
    password: process.env.MEGA_PASSWORD as string
})

// Multer configuration to store files in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Cross-Origin Requests configuration
app.use(cors({
    origin: [''],
    methods: ['']
}))

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic route to check if the server is running
app.get('/', (req: Request, res: Response) => {
    res.json({ message: "hi" });
});

// Route to handle video uploads
app.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    const { title } = req.body as { title: string };

    // Check if a file is uploaded
    if (!req.file) {
        return res.json({ message: 'No file uploaded' });
    }

    // Check if title is provided
    if (!title) {
        return res.json({ message: 'Title is required' });
    }

    const lessonId: string = uuid4();
    const fileName: string = `${lessonId}${path.extname(req.file.originalname)}`

    // Path definitions
    const videoPath: string = path.join(__dirname, 'uploads', fileName); // Video existing location
    const outputPath: string = path.join(__dirname, 'uploads', lessonId); // Video upload location
    const hlsPath: string = path.join(outputPath, 'index.m3u8'); // HLS manifest file location

    try {
        // Write uploaded file to disk
        fs.writeFileSync(videoPath, req.file.buffer);
        
        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputPath)) {
            fs.mkdirSync(outputPath, { recursive: true });
        }

        // Process video with ffmpeg to create HLS files
        ffmpeg(videoPath)
            .outputOptions([
                '-codec:v libx264',
                '-codec:a aac',
                '-hls_time 10',
                '-hls_playlist_type vod',
                '-hls_segment_filename ' + path.join(outputPath, 'segment%03d.ts'),
                '-start_number 0'
            ])
            .output(hlsPath)
            .on('end', async () => {
                try {
                    // Upload HLS files to Mega
                    const megaFolder = await mega.mkdir(lessonId);
                    const hlsFiles: string[] = fs.readdirSync(outputPath);

                    const uploadPromises: Promise<any>[] = hlsFiles.map(file => megaFolder.upload({
                        name: file,
                        data: fs.readFileSync(path.join(outputPath, file))
                    }))

                    const megaFiles = await Promise.all(uploadPromises);

                    // Get the public link for the uploaded HLS files
                    const megaUrls: string[] = await Promise.all(megaFiles.map(file => file.link()));
                    const hlsUrl: string | undefined = megaUrls.find(url => url.endsWith('index.m3u8'));

                    if (!hlsUrl) {
                        throw new Error('HLS manifest file not found in Mega uploads')
                    }

                    // Save file information in PostgreSQL
                    const video: Video = await prisma.video.create({
                        data: {
                            title: title,
                            name: req.file.originalname,
                            url: hlsUrl
                        }
                    })

                    // Clean up local files
                    fs.unlinkSync(videoPath);
                    hlsFiles.forEach(file => fs.unlinkSync(path.join(outputPath, file)));

                    res.json({
                        message: 'Video uploaded successfully',
                        videoUrl: hlsUrl,
                        lessonId: video.id
                    });

                } catch (error) {
                    console.error("Error in uploading files to Mega:", error);
                    res.status(500).json({ message: "Error in uploading files to Mega" });
                }
            })
            .on('error', (err) => {
                console.error('Error processing the video:', err);
                res.status(500).json({ message: "Error processing the video" });
            })
            .run();

    } catch (error) {
        console.error('Error writing file to disk or creating directory:', error);
        res.status(500).json({ message: "Error writing file or creating directory" });
    }
    
})

// Route to search for videos
app.get('/search', async (req: Request, res: Response) => {
    const { query } = req.query as { query: string };

    // Validate search query
    if (typeof query != 'string' || !query) {
        return res.status(400).json({ message: "Invalid Search Query" });
    }

    try {
        // Search for the video in PostgreSQL
        const videos: Video[] = await prisma.video.findMany({
            where: {
                title: {
                    contains: query,
                    mode: "insensitive"
                }
            }
        })

        res.json(videos);
    } catch (error) {
        console.error('Error in finding the videos:', error);
        res.status(500).json({ message: "Error performing the search" });
    }
})

// Start the server
app.listen(5000, () => {
    console.log('Listening on port 5000');
})
