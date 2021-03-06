const express = require('express');
//Create a new instance of express
const app = express();
const bodyParser = require("body-parser");

let db = require('../utilities/utils').db;
let pushNoti = require('../utilities/push_noti.js').handleSingleToken;

var router = express.Router();
router.use(bodyParser.json());


// Service to get all Invitations 
router.get("/", (req, res) => {
    let receiverid = req.query['memberid'];
    let query = `select c.name, m.username, c.chatid
        from chats c left join invitations i on c.chatid = i.roomid
        left join members m on i.senderid = m.memberid
        where i.receiverid = $1 and i.verified = false;`

    // Query all the chatrooms a user is in    
    db.manyOrNone(query, [receiverid])
    .then((rows) => {
        res.send({
            invitations : rows
        })
        console.log(rows);
    }).catch((err) => {
        res.send({
            success: false,
            error: err
        })
    });
});

// Service to send an invitation
router.post("/", (req, res) => {
    let sender = req.body['sender'];
    let receiver = req.body['receiver'];
    let ID = req.body['chatid'];

    let invite = `INSERT INTO Invitations(SenderId, ReceiverId, Roomid)
                VALUES
                ((SELECT MemberId FROM Members WHERE Username = $1),
                (SELECT MemberId FROM Members WHERE Username = $2),
                $3)`;
    let params = [sender, receiver, ID];
    let checkIfUserExists = `select memberid from chatmembers
                            where chatid = $1
                            and memberid = (select memberid from members where username = $2)`;
    let checkIfInvitationExist = `select from invitations
                    where roomid = $1 and receiverid = (SELECT MemberId FROM Members WHERE Username = $2)
                    and senderid = (SELECT MemberId FROM Members WHERE Username = $3)`;

    // Check if other already in the room
    db.oneOrNone(checkIfUserExists, [ID, receiver])
    .then(data => {
        console.log(data);
        // Case they're in the room
        if (data) {
            res.send({
                success: false,
                error: "user exists in room"
            });
            return;
        } else { 
            // continue to check if the other user receive invitation from same sender or not.
            // Note: they could receive invitations to the same room but from others
            db.oneOrNone(checkIfInvitationExist, [ID, receiver, sender])
            .then(data => {
                if (data) {
                    res.send({
                        success: false,
                        error: "You already invited them. Hang in there!",
                    });
                    return;
                } else { // Ok, they're not in the room and isn't invited yet
                    // Add an invitation entry in the Invitations
                    db.none(invite, params)
                    .then(()=> {
                        // Then push notification to the receiver
                        db.one("select firebase_token from Members where username=$1", receiver)
                        .then((row) =>{
                            pushNoti(row.firebase_token, "Want to join my chat room?", sender, "invitation");
                        })
                        .catch(err=>{
                            res.send({
                                success : false,
                                message : "can't find token",
                                error : err
                            });
                        });
                    })
                    .catch(err =>{
                        res.send({
                            success : false,
                            message : "can't send invitation",
                            error : err
                        });
                    });
                }
            })
            .catch(err =>{
                res.send({
                    success : false,
                    error : err
                });
            });
        }
    })
    .catch(err => {
        res.send({
            success : false,
            message : "error in checkIfUserExists",
            error : err
        });
    });
});

// Service to response to an invitation
router.put('/response', (req, res)=> {
    let userid = req.body['memberid'];
    let chatid = req.body['chatid'];
    let accept = req.body['accept'];
    let params = [chatid, userid];
    console.log("Userid " + userid);
    let add = `insert into chatmembers(chatid, memberid) values ($1, $2)`;
    let joinQuery = `update invitations set Verified = true where roomid = $1 and receiverid = $2`;
    let delQuery = `delete from invitations where roomid = $1 and receiverid = $2`;
    db.none(delQuery, params)
    .then(() => {
        if (accept) {
            db.none(add, params)
            .then(()=> {
                res.send({
                    success : true,
                    message : "added to room"
                });
            })
            .catch(err => {
                res.send({
                    success : false,
                    error : "add error",
                    detail : err
                });
            });
        } else {
            res.send({
                success : true,
                message : "declined"
            });
        }
    })
    .catch(err => {
        res.send({
            success : false,
            error : "error deleting invitation"
        });
    });
});


module.exports = router;