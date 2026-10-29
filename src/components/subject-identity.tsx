import {Text,View,StyleSheet,type StyleProp,type TextStyle} from "react-native";
import {subjectPresentationView} from "../lib/subject-presentation-display";
import type {PresentedSubject,SubjectPresentationDefinition} from "../lib/subject-presentation";
export function SubjectIdentity({subject,config,definition,titleStyle}:{subject:PresentedSubject;config?:unknown;definition?:SubjectPresentationDefinition;titleStyle?:StyleProp<TextStyle>}){
 if(config===undefined)return <Text style={titleStyle}>{subject.displayName}</Text>;
 const view=subjectPresentationView(subject,config,definition);
 const {flex,flexGrow,flexShrink,width,...textStyle}=StyleSheet.flatten(titleStyle)??{};
 return <View style={{minWidth:0,flexShrink:flexShrink??1,gap:3,flex,flexGrow,width}}><Text style={textStyle}>{view.title}</Text>{view.secondary.map(cell=><Text key={cell.fieldId} style={{color:"#526174",flexShrink:1}}>{cell.label}: {cell.value}</Text>)}{view.issue?<Text style={{color:"#785000",flexShrink:1}}>{view.issue}</Text>:null}</View>;
}
