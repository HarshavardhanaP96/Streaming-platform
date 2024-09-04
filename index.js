import express from "express";
import cors from "cors";
import multer from "multer";
import {v4 as uuidv4} from "uuid";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { error } from "console";
import { stderr, stdout } from "process";


const app =express();

//multer midleware

const storage=multer.diskStorage({
    destination:function(req,file, callback){
        callback(null, "/../uploads")
    },
    filename:function(req,file, callback){
        callback(null,file.fieldname + "-" + uuidv4()+ path.extname(file.originalname))
    }
})

//multer configuration
const upload= multer({storage:storage})


app.use(
    cors({
        origin:["http://localhost:3000","http://localhost:5173"],
        credentials:true
    })
)

app.use((req,res,next)=>{
    res.header("Access-Control-Allow-Origin" ,"*") //don't use * to allow all
    res.header("Access-Control-Allow-Headers","Origin, X-Requested-With, Content-Type, Accept"); //not necessary
    next()
})

app.use(express.json())
app.use(express.urlencoded({extended:true}))
app.use("/uploads",express.static("uploads"))


app.get('/',(req,res)=>{
    res.json({message:"hi"})
})

app.post("/upload",upload.single('file'),(req, res)=>{
  
    // convert video in HLS format

    const lessonId=uuidv4();
    const videoPath=req.file.path
    const outputPath=`./uploads/courses/${lessonId}`
    const hlsPath=`${outputPath}/index.m3u8`
    console.log("hlsPath",hlsPath)

    // if the output directory doesn't exist, create it

    if(!fs.existsSync(outputPath)){
        fs.mkdirSync(outputPath, {recursive:true})
    }

    // command to convert video to HLS format using ffmpeg
    const ffmpegCommand = `ffmpeg -i ${videoPath} -codec:v libx264 -codec:a aac -hls_time 10 -hls_playlist_type vod -hls_segment_filename "${outputPath}/segment%03d.ts" -start_number 0 ${hlsPath}`;


    // run the ffmpeg command; usually done in a separate process (queued)
    //no que because just po,not to be used in production
    exec(ffmpegCommand,(error, stdout, stderr)=>{
        if(error){
            console.log(`exec error:${error}`);
        }
        console.log(`stdout:${stdout}`);
        console.log(`stderr:${stderr}`);
        const videoUrl=`http://localhost:8000/uploads/courses/${lessonId}/index.m3u8`

        res.json({
            message:"video converted to HLS format",
            videoUrl:videoUrl,
            lessonId:lessonId
        })
    })

})

app.listen(8000,()=>{
    console.log("app is listening at port 8000");
})