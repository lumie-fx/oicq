import { pb } from "../core"
import { log } from "../common"
import { FriendAddReqEvent, GroupAddReqEvent, GroupInviteReqEvent } from "../events"

type Client = import("../client").Client

function genFriendRequestFlag(user_id: number, seq: number, single = false) {
	let flag = user_id.toString(16).padStart(8, "0") + seq.toString(16)
	if (single) flag = "~" + flag
	return flag
}

export function parseFriendRequestFlag(flag: string) {
	let single = false
	if (flag.startsWith("~")) {
		flag = flag.slice(1)
		single = true
	}
	const user_id = parseInt(flag.slice(0, 8), 16)
	const seq = Number("0x" + flag.slice(8))
	return { user_id, seq, single }
}

function genGroupRequestFlag(user_id: number, group_id: number, seq: number | bigint, invite: 0 | 1) {
	const buf = Buffer.allocUnsafe(8)
	buf.writeUInt32BE(user_id), buf.writeUInt32BE(group_id, 4)
	return buf.toString("hex") + invite + seq.toString(16)
}

export function parseGroupRequestFlag(flag: string) {
	const user_id = parseInt(flag.slice(0, 8), 16)
	const group_id = parseInt(flag.slice(8, 16), 16)
	const invite = parseInt(flag.slice(16, 17))
	const seq = Number("0x" + flag.slice(17))
	return { user_id, group_id, seq, invite }
}

function parseFrdSysMsg(proto: pb.Proto): FriendAddReqEvent {
	let single: boolean
	if (proto[50][1] === 9 && String(proto[50][6]) === "")
		single = true
	else if (proto[50][1] === 1)
		single = false
	else
		throw new Error("unsupported friend request type: " + proto[50][1])
	const time = proto[4]
	const user_id = proto[5]
	const nickname = String(proto[50][51])
	const seq = proto[3]
	const flag = genFriendRequestFlag(user_id, proto[3], proto[50][1] === 9 ? true : false)
	const source = String(proto[50][5])
	const comment = String(proto[50][4] ? proto[50][4] : "")
	const sex = proto[50][67] === 0 ? "male" : (proto[50][67] === 1 ? "female" : "unknown")
	const age = proto[50][68]
	return {
		request_type: "friend",
		sub_type: single ? "single" : "add",
		user_id, nickname, source, comment, seq, sex, age, flag, time
	}
}

function parseGrpSysMsg(proto: pb.Proto): GroupAddReqEvent | GroupInviteReqEvent {
	if (proto[50][1] !== 1)
		throw new Error("unsupported group request type: " + proto[50][1])
	const type = proto[50][12]
	const time = proto[4]
	const group_id = proto[50][10]
	const group_name = String(proto[50][52])
	const seq = proto[3]
	if (type === 2) { //invite
		return {
			request_type: "group",
			sub_type: "invite",
			time,
			group_id,
			group_name,
			seq,
			user_id: proto[50][11],
			nickname: String(proto[50][53]),
			role: proto[50][13] === 1 ? "member" : "admin",
			flag: genGroupRequestFlag(proto[50][11], group_id, seq, 1)
		}
	} else if (type === 1 || type === 22) { //add
		return {
			request_type: "group",
			sub_type: "add",
			time,
			group_id,
			group_name,
			user_id: proto[5],
			seq,
			nickname: String(proto[50][51]),
			comment: String(proto[50][4]),
			inviter_id: proto[50][11],
			tips: String(proto[50][32]),
			flag: genGroupRequestFlag(proto[5], group_id, seq, 0)
		}
	}
	throw new Error("unsupported group request sub type: " + type)
}

const FRD_BUF = pb.encode({
	1: 20,
	4: 1000,
	5: 2,
	6: {
		4: 1,
		7: 1,
		9: 1,
		10: 1,
		15: 1,
	},
	7: 0,
	8: 0,
	9: 0,
	10: 1,
	11: 2
})

export async function getFriendSystemMessage(this: Client) {
	try {
		const payload = await this.sendUni("ProfileService.Pb.ReqSystemMsgNew.Friend", FRD_BUF)
		let rsp = pb.decode(payload)[9]
		if (!Array.isArray(rsp)) rsp = [rsp]
		for (const proto of rsp) {
			try {
				const e = parseFrdSysMsg(proto)
				if (this._msgExists(e.user_id, 0, proto[3], e.time))
					continue
				if (e.sub_type === "single") {
					this.sl.set(e.user_id, {
						user_id: e.user_id,
						nickname: e.nickname,
					})
					this.logger.info(`${e.user_id}(${e.nickname}) 将你添加为单向好友 (flag: ${e.flag})`)
					this.em("request.friend.single", e)
				} else {
					this.logger.info(`收到 ${e.user_id}(${e.nickname}) 的加好友请求 (flag: ${e.flag})`)
					this.em("request.friend.add", e)
				}
			} catch (e: any) {
				this.logger.trace(e.message)
			}
		}
	} catch (e) {
		this.logger.error("获取好友系统消息失败")
		this.logger.error(e)
	}
}

const GRP_BUF = pb.encode({
	1: 20,
	4: 1000,
	5: 3,
	6: {
		1: 1,
		2: 1,
		3: 1,
		5: 1,
		6: 1,
		7: 1,
		8: 1,
		9: 1,
		10: 1,
		11: 1,
		12: 1,
		13: 1,
		14: 1,
		15: 1,
		16: 1,
		17: 1,
	},
	7: 0,
	8: 0,
	9: 0,
	10: 1,
	11: 1,
})

const GRP_BUF_RISK = pb.encode({
	1: 20,
	4: 1000,
	5: 3,
	6: {
		1: 1,
		2: 1,
		3: 1,
		5: 1,
		6: 1,
		7: 1,
		8: 1,
		9: 1,
		10: 1,
		11: 1,
		12: 1,
		13: 1,
		14: 1,
		15: 1,
		16: 1,
		17: 1,
	},
	7: 0,
	8: 0,
	9: 0,
	10: 1,
	11: 2,
})

export async function getGroupSystemMessage(this: Client) {
	try {
		let arr: pb.Proto[] = []
		{
			const payload = await this.sendUni("ProfileService.Pb.ReqSystemMsgNew.Group", GRP_BUF)
			let rsp = pb.decode(payload)[10]
			if (rsp) arr = arr.concat(rsp)
		}
		{
			const payload = await this.sendUni("ProfileService.Pb.ReqSystemMsgNew.Group", GRP_BUF_RISK)
			let rsp = pb.decode(payload)[10]
			if (rsp) arr = arr.concat(rsp)
		}
		for (let proto of arr) {
			try {
				const e = parseGrpSysMsg(proto)
				if (this._msgExists(e.group_id, proto[50][12], proto[3], e.time))
					continue
				if (e.sub_type === "add") {
					this.logger.info(`用户 ${e.user_id}(${e.nickname}) 请求加入群 ${e.group_id}(${e.group_name}) (flag: ${e.flag})`)
					this.em("request.group.add", e)
				} else {
					this.logger.info(`用户 ${e.user_id}(${e.nickname}) 邀请你加入群 ${e.group_id}(${e.group_name}) (flag: ${e.flag})`)
					this.em("request.group.invite", e)
				}
			} catch (e: any) {
				this.logger.trace(e.message)
			}
		}
	} catch (e) {
		this.logger.error("获取群系统消息失败")
		this.logger.error(e)
	}
}

export async function getSystemMessage(this: Client) {
	const ret: Array<FriendAddReqEvent | GroupAddReqEvent | GroupInviteReqEvent> = []

	const task1 = (async () => {
		const blob = await this.sendUni("ProfileService.Pb.ReqSystemMsgNew.Friend", FRD_BUF)
		let rsp = pb.decode(blob)[9]
		if (!rsp) return
		if (!Array.isArray(rsp))
			rsp = [rsp]
		const dbl = new Set
		for (let proto of rsp) {
			try {
				const e = parseFrdSysMsg(proto)
				if (dbl.has(e.user_id)) continue
				dbl.add(e.user_id)
				ret.push(e)
			} catch { }
		}
	})()

	const task2 = (async () => {
		let arr: pb.Proto[] = []
		{
			const blob = await this.sendUni("ProfileService.Pb.ReqSystemMsgNew.Group", GRP_BUF)
			let rsp = pb.decode(blob)[10]
			if (rsp) arr = arr.concat(rsp)
		}
		{
			const blob = await this.sendUni("ProfileService.Pb.ReqSystemMsgNew.Group", GRP_BUF_RISK)
			let rsp = pb.decode(blob)[10]
			if (rsp) arr = arr.concat(rsp)
		}
		for (let proto of arr) {
			try {
				const e = parseGrpSysMsg(proto)
				ret.push(e)
			} catch { }
		}
	})()

	await Promise.all([task1, task2])
	return ret
}
