import { type ThemeColors } from "../theme/tokens";
import { colors } from "../theme/paint";
import {Text,View,StyleSheet,type StyleProp,type TextStyle} from "react-native";
import {subjectPresentationView} from "../lib/subject-presentation-display";
import type {PresentedSubject,SubjectPresentationDefinition} from "../lib/subject-presentation";
export function SubjectIdentity({subject,config,definition,titleStyle}:{subject:PresentedSubject;config?:unknown;definition?:SubjectPresentationDefinition;titleStyle?:StyleProp<TextStyle>}){
 if(config===undefined)return <Text style={[styles.title,titleStyle]}>{subject.displayName}</Text>;
 const view=subjectPresentationView(subject,config,definition);
 const {flex,flexGrow,flexShrink,width,...textStyle}=StyleSheet.flatten(titleStyle)??{};
 return <View style={{minWidth:0,flexShrink:flexShrink??1,gap:3,flex,flexGrow,width}}><Text style={[styles.title,textStyle]}>{view.title}</Text>{view.secondary.map(cell=><Text key={cell.fieldId} style={styles.secondary}>{cell.label}: {cell.value}</Text>)}{view.issue?<Text style={styles.issue}>{view.issue}</Text>:null}</View>;
}

export function createSubjectIdentityStyles(p:ThemeColors=colors){return StyleSheet.create({title:{color:p.text},secondary:{color:p.textSecondary,flexShrink:1},issue:{color:p.warning,flexShrink:1}})}
const styles=createSubjectIdentityStyles();
